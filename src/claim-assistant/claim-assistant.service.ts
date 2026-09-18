import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import {
  claimDrafts,
  issueScores,
  watchedRepos,
  type ClaimGateSnapshot,
} from '../database/schema';
import { GITHUB_CLIENT } from '../github/github.module';
import type { GithubClient } from '../github/github-client.interface';
import { CLAIM_DECISION_PROVIDER } from './claim-decision-provider.token';
import type { ClaimDecisionProvider } from './claim-decision-provider.interface';
import { evaluateGate } from './claim-gate';
import { decideSafely } from './decide-safely';

@Injectable()
export class ClaimAssistantService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(GITHUB_CLIENT) private readonly githubClient: GithubClient,
    @Inject(CLAIM_DECISION_PROVIDER)
    private readonly claimDecisionProvider: ClaimDecisionProvider,
  ) {}

  async listDrafts(watchedRepoId: string, userId: string) {
    await this.getOwnedWatchedRepo(watchedRepoId, userId);
    return this.db
      .select()
      .from(claimDrafts)
      .where(eq(claimDrafts.watchedRepoId, watchedRepoId))
      .orderBy(desc(claimDrafts.createdAt));
  }

  async draftClaim(watchedRepoId: string, issueNumber: number, userId: string) {
    const repo = await this.getOwnedWatchedRepo(watchedRepoId, userId);
    const score = await this.getIssueScore(watchedRepoId, issueNumber);

    const gateReasons = evaluateGate(score);
    const gateSnapshot = this.snapshotOf(score);

    if (gateReasons.length > 0) {
      return this.insertDraft({
        watchedRepoId,
        issueNumber,
        status: 'abstained',
        gateReasons,
        gateSnapshot,
      });
    }

    const decision = await decideSafely(this.claimDecisionProvider, {
      issueTitle: score.title,
      issueBody: score.body,
      repoOwner: repo.owner,
      repoName: repo.name,
    });

    if (decision.decision === 'abstain') {
      return this.insertDraft({
        watchedRepoId,
        issueNumber,
        status: 'abstained',
        gateReasons: [],
        gateSnapshot,
        llmAbstainReason: decision.reason,
      });
    }

    return this.insertDraft({
      watchedRepoId,
      issueNumber,
      status: 'pending_review',
      gateReasons: [],
      gateSnapshot,
      draftComment: decision.comment,
    });
  }

  async approve(draftId: string, userId: string) {
    const { draft, repo } = await this.getOwnedDraft(draftId, userId);

    // Atomically claim the row (pending_review -> approved) before doing
    // anything else. Two concurrent approve() calls on the same draft
    // (a double-click before the button disables, or two open tabs) would
    // otherwise both read status 'pending_review', both pass a plain
    // status check, and both post the same comment to the real issue -
    // this conditional UPDATE means only whichever request actually wins
    // the row proceeds; the loser gets a clean "already handled" error
    // instead of a duplicate GitHub write.
    const [claimed] = await this.db
      .update(claimDrafts)
      .set({ status: 'approved' })
      .where(
        and(
          eq(claimDrafts.id, draftId),
          eq(claimDrafts.status, 'pending_review'),
        ),
      )
      .returning();
    if (!claimed) {
      throw new BadRequestException(
        `draft "${draftId}" is not pending review (status: ${draft.status})`,
      );
    }

    // issue_scores is a snapshot that gets overwritten on every refresh
    // (see schema.ts) - re-running the gate here catches an issue that
    // got assigned or picked up a competing PR since this draft was
    // written, which may have been a while ago (the review queue exists
    // precisely so drafts can sit before being acted on).
    const currentScore = await this.getIssueScore(
      draft.watchedRepoId,
      draft.issueNumber,
    );
    const freshGateReasons = evaluateGate(currentScore);
    if (freshGateReasons.length > 0) {
      // Hand the row back to pending_review instead of leaving it stuck at
      // 'approved' with nothing posted - the user can still see it and
      // decide (reject it, or wait and try approving again later).
      await this.db
        .update(claimDrafts)
        .set({ status: 'pending_review' })
        .where(eq(claimDrafts.id, draftId));
      throw new BadRequestException(
        `no longer safe to claim (${freshGateReasons.join(', ')}) - refresh and re-draft`,
      );
    }

    // If this call itself throws (network error, GitHub outage), the row
    // is deliberately left at 'approved' rather than auto-reverted to
    // pending_review - reverting it would let a retry double-post if this
    // attempt actually succeeded on GitHub's side but the response never
    // came back. An 'approved' row with no postedCommentUrl is an honest
    // "we don't know if this posted" state for a solo user to check by
    // hand, which is safer than guessing.
    const posted = await this.githubClient.postIssueComment(
      repo.owner,
      repo.name,
      draft.issueNumber,
      claimed.draftComment ?? '',
    );

    const [updated] = await this.db
      .update(claimDrafts)
      .set({
        status: 'posted',
        postedCommentUrl: posted.url,
        decidedAt: new Date(),
      })
      .where(eq(claimDrafts.id, draftId))
      .returning();
    return updated;
  }

  async reject(draftId: string, userId: string) {
    const { draft } = await this.getOwnedDraft(draftId, userId);
    if (draft.status !== 'pending_review') {
      throw new BadRequestException(
        `draft "${draftId}" is not pending review (status: ${draft.status})`,
      );
    }

    const [updated] = await this.db
      .update(claimDrafts)
      .set({ status: 'rejected', decidedAt: new Date() })
      .where(eq(claimDrafts.id, draftId))
      .returning();
    return updated;
  }

  // claim_drafts has no user_id of its own (not denormalized, same call
  // as issue_scores) - ownership is proven by joining through the parent
  // watched_repos row, exactly like IssuesController/RefreshService.
  private async getOwnedDraft(draftId: string, userId: string) {
    const [row] = await this.db
      .select({ draft: claimDrafts, repo: watchedRepos })
      .from(claimDrafts)
      .innerJoin(watchedRepos, eq(claimDrafts.watchedRepoId, watchedRepos.id))
      .where(and(eq(claimDrafts.id, draftId), eq(watchedRepos.userId, userId)));
    if (!row) {
      throw new NotFoundException(`no claim draft with id "${draftId}"`);
    }
    return row;
  }

  private async getOwnedWatchedRepo(watchedRepoId: string, userId: string) {
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
    return repo;
  }

  private async getIssueScore(watchedRepoId: string, issueNumber: number) {
    const [score] = await this.db
      .select()
      .from(issueScores)
      .where(
        and(
          eq(issueScores.watchedRepoId, watchedRepoId),
          eq(issueScores.issueNumber, issueNumber),
        ),
      );
    if (!score) {
      throw new NotFoundException(
        `no scored issue #${issueNumber} on this watched repo - refresh first`,
      );
    }
    return score;
  }

  private snapshotOf(score: {
    hasAssignee: boolean;
    openCompetingPrCount: number;
    sentimentLabel: string | null;
    score: number;
  }): ClaimGateSnapshot {
    return {
      hasAssignee: score.hasAssignee,
      openCompetingPrCount: score.openCompetingPrCount,
      sentimentLabel: score.sentimentLabel,
      score: score.score,
    };
  }

  private async insertDraft(input: {
    watchedRepoId: string;
    issueNumber: number;
    status: 'abstained' | 'pending_review';
    gateReasons: string[];
    gateSnapshot: ClaimGateSnapshot;
    llmAbstainReason?: string;
    draftComment?: string;
  }) {
    const [created] = await this.db
      .insert(claimDrafts)
      .values({ id: randomUUID(), ...input })
      .returning();
    return created;
  }
}
