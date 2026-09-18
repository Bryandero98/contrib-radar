import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import { issueScores, users, watchedRepos } from '../database/schema';
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
    private readonly alertsService: AlertsService,
  ) {}

  async refreshWatchedRepo(
    watchedRepoId: string,
    userId: string,
  ): Promise<RefreshResult> {
    const [repo] = await this.db
      .select()
      .from(watchedRepos)
      .where(
        and(
          eq(watchedRepos.id, watchedRepoId),
          eq(watchedRepos.userId, userId),
        ),
      );
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

    // Snapshot which issue numbers were already scored *before* this
    // refresh's upserts, so alerting can tell "new" from "still open" -
    // issueScores is an upsert-in-place snapshot (see the schema comment),
    // it never records when a row first appeared.
    const previouslyScored = new Set(
      (
        await this.db
          .select({ issueNumber: issueScores.issueNumber })
          .from(issueScores)
          .where(eq(issueScores.watchedRepoId, watchedRepoId))
      ).map((row) => row.issueNumber),
    );

    const scores = new Map<number, number>();
    for (const issue of issues) {
      scores.set(issue.number, await this.scoreAndUpsert(watchedRepoId, issue));
    }

    // issue_scores is a snapshot of "currently open and matching the label
    // filter" (see schema.ts), not a log - an issue that got closed, lost
    // the label, or was reassigned out of the filter since the last refresh
    // simply won't be in `issues` anymore, and without this it would sit
    // here forever with its last-known score, silently lying about being
    // a live opportunity.
    const currentIssueNumbers = issues.map((issue) => issue.number);
    await this.db
      .delete(issueScores)
      .where(
        currentIssueNumbers.length > 0
          ? and(
              eq(issueScores.watchedRepoId, watchedRepoId),
              notInArray(issueScores.issueNumber, currentIssueNumbers),
            )
          : eq(issueScores.watchedRepoId, watchedRepoId),
      );

    await this.db
      .update(watchedRepos)
      .set({ lastRefreshedAt: new Date() })
      .where(eq(watchedRepos.id, watchedRepoId));

    await this.alertNewIssues(userId, repo, issues, previouslyScored, scores);

    return { refreshed: true, issueCount: issues.length };
  }

  // Awaited (not detached), but a webhook failure is logged inside
  // AlertsService and never rethrown, so it can delay a refresh's response
  // (bounded by AlertsService's own timeout) but never fail it.
  private async alertNewIssues(
    userId: string,
    repo: { owner: string; name: string },
    issues: GithubIssue[],
    previouslyScored: Set<number>,
    scores: Map<number, number>,
  ): Promise<void> {
    const newIssues = issues.filter(
      (issue) => !previouslyScored.has(issue.number),
    );
    if (newIssues.length === 0) return;

    const [user] = await this.db
      .select({ alertWebhookUrl: users.alertWebhookUrl })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.alertWebhookUrl) return;

    await this.alertsService.notifyNewIssues(
      user.alertWebhookUrl,
      newIssues.map((issue) => ({
        owner: repo.owner,
        name: repo.name,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        score: scores.get(issue.number) ?? 0,
      })),
    );
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
  ): Promise<number> {
    const sentiment = await this.classifySentiment(issue);
    const result = this.scoringService.score({ issue, sentiment });
    const row = {
      title: issue.title,
      body: issue.body,
      url: issue.url,
      state: issue.state,
      githubUpdatedAt: new Date(issue.updatedAt),
      hasAssignee: result.hasAssignee,
      openCompetingPrCount: result.openCompetingPrCount,
      openDraftPrCount: result.openDraftPrCount,
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

    return result.score;
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
