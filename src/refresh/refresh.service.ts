import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import { issueScores, watchedRepos } from '../database/schema';
import { GITHUB_CLIENT } from '../github/github.module';
import type {
  GithubClient,
  GithubIssue,
} from '../github/github-client.interface';
import { ScoringService } from '../scoring/scoring.service';
import { REFRESH_COOLDOWN_MINUTES } from '../scoring/weights';
import { classifySafely } from '../sentiment/classify-safely';
import type { SentimentProvider } from '../sentiment/sentiment-provider.interface';
import { SENTIMENT_PROVIDER } from '../sentiment/sentiment.module';

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export interface RefreshResult {
  /** false means the cached issue_scores snapshot was returned untouched - the cooldown was still active. */
  refreshed: boolean;
  issueCount: number;
}

// Orchestrates GitHub -> scoring -> sentiment -> upsert. Every write to
// issue_scores goes through here - watched-repos and issues stay
// read/write-simple CRUD, this is the one module that talks to both
// external APIs.
@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(GITHUB_CLIENT) private readonly githubClient: GithubClient,
    @Inject(SENTIMENT_PROVIDER)
    private readonly sentimentProvider: SentimentProvider,
    private readonly scoringService: ScoringService,
  ) {}

  async refreshWatchedRepo(watchedRepoId: string): Promise<RefreshResult> {
    const [repo] = await this.db
      .select()
      .from(watchedRepos)
      .where(eq(watchedRepos.id, watchedRepoId));
    if (!repo) {
      throw new NotFoundException(`no watched repo with id "${watchedRepoId}"`);
    }

    if (repo.lastRefreshedAt && this.withinCooldown(repo.lastRefreshedAt)) {
      const cached = await this.db
        .select()
        .from(issueScores)
        .where(eq(issueScores.watchedRepoId, watchedRepoId));
      return { refreshed: false, issueCount: cached.length };
    }

    const issues = await this.githubClient.fetchIssuesForScoring({
      owner: repo.owner,
      name: repo.name,
      labels: repo.labelFilter,
    });

    for (const issue of issues) {
      await this.scoreAndUpsert(watchedRepoId, issue);
    }

    await this.db
      .update(watchedRepos)
      .set({ lastRefreshedAt: new Date() })
      .where(eq(watchedRepos.id, watchedRepoId));

    return { refreshed: true, issueCount: issues.length };
  }

  // Used by check_issue_feasibility (Fase 5's MCP tool): always live, no
  // cooldown, no persistence - freshness matters more than API cost for a
  // single on-demand lookup.
  async scoreSingleIssue(owner: string, name: string, issueNumber: number) {
    const issue = await this.githubClient.fetchSingleIssueForScoring(
      owner,
      name,
      issueNumber,
    );
    if (!issue) {
      return null;
    }
    const sentiment = await this.classifySentiment(issue);
    return this.scoringService.score({ issue, sentiment });
  }

  private async scoreAndUpsert(
    watchedRepoId: string,
    issue: GithubIssue,
  ): Promise<void> {
    const sentiment = await this.classifySentiment(issue);
    const result = this.scoringService.score({ issue, sentiment });
    const row = {
      title: issue.title,
      url: issue.url,
      state: issue.state,
      githubUpdatedAt: new Date(issue.updatedAt),
      hasAssignee: result.hasAssignee,
      openCompetingPrCount: result.openCompetingPrCount,
      abandonedPrCount: result.abandonedPrCount,
      sentimentLabel: sentiment?.label ?? null,
      sentimentRationale: sentiment?.rationale ?? null,
      score: result.score,
      reasons: result.reasons,
    };

    await this.db
      .insert(issueScores)
      .values({ watchedRepoId, issueNumber: issue.number, ...row })
      .onConflictDoUpdate({
        target: [issueScores.watchedRepoId, issueScores.issueNumber],
        set: { ...row, scoredAt: new Date() },
      });
  }

  private async classifySentiment(issue: GithubIssue) {
    const maintainerComments = issue.comments
      .filter((c) => MAINTAINER_ASSOCIATIONS.has(c.authorAssociation))
      .map((c) => ({ body: c.body, createdAt: c.createdAt }));

    if (!issue.maintainerCommentsFullyChecked) {
      this.logger.warn(
        `#${issue.number}: maintainer comments could not be fully verified (fallback page fetch failed) - sentiment based on a possibly incomplete view`,
      );
    }

    return classifySafely(this.sentimentProvider, {
      issueTitle: issue.title,
      maintainerComments,
    });
  }

  private withinCooldown(lastRefreshedAt: Date): boolean {
    const cooldownMs = REFRESH_COOLDOWN_MINUTES * 60 * 1000;
    return Date.now() - lastRefreshedAt.getTime() < cooldownMs;
  }
}
