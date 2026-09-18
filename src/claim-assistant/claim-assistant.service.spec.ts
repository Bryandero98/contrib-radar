import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { issueScores, users, watchedRepos } from '../database/schema';
import type { GithubClient } from '../github/github-client.interface';
import { GITHUB_CLIENT } from '../github/github.module';
import { ClaimAssistantService } from './claim-assistant.service';
import { CLAIM_DECISION_PROVIDER } from './claim-decision-provider.token';
import type {
  ClaimCandidate,
  ClaimDecisionProvider,
  ClaimDecisionResult,
} from './claim-decision-provider.interface';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

class FakeClaimDecisionProvider implements ClaimDecisionProvider {
  readonly name = 'fake';
  nextResult: ClaimDecisionResult = {
    decision: 'claim',
    comment: "I'd like to take this on.",
  };
  calls: ClaimCandidate[] = [];

  decide(candidate: ClaimCandidate): Promise<ClaimDecisionResult> {
    this.calls.push(candidate);
    return Promise.resolve(this.nextResult);
  }
}

class FakeGithubClient implements GithubClient {
  postedComments: {
    owner: string;
    name: string;
    issueNumber: number;
    body: string;
  }[] = [];

  fetchIssuesForScoring() {
    return Promise.resolve([]);
  }
  fetchSingleIssueForScoring() {
    return Promise.resolve(null);
  }
  postIssueComment(
    owner: string,
    name: string,
    issueNumber: number,
    body: string,
  ) {
    this.postedComments.push({ owner, name, issueNumber, body });
    return Promise.resolve({
      url: `https://github.com/${owner}/${name}/issues/${issueNumber}#issuecomment-1`,
    });
  }
}

describeIfDb('ClaimAssistantService', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let userId: string;
  let otherUserId: string;
  let watchedRepoId: string;
  let githubClient: FakeGithubClient;
  let claimDecisionProvider: FakeClaimDecisionProvider;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });

    userId = randomUUID();
    otherUserId = randomUUID();
    await db.insert(users).values([
      { id: userId, githubId: `gh-${userId}`, githubLogin: 'octocat' },
      {
        id: otherUserId,
        githubId: `gh-${otherUserId}`,
        githubLogin: 'someone-else',
      },
    ]);

    watchedRepoId = randomUUID();
    await db.insert(watchedRepos).values({
      id: watchedRepoId,
      userId,
      owner: 'o',
      name: 'r',
      labelFilter: ['good first issue'],
    });

    githubClient = new FakeGithubClient();
    claimDecisionProvider = new FakeClaimDecisionProvider();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM claim_drafts WHERE watched_repo_id = $1`, [
      watchedRepoId,
    ]);
    await pool.query(`DELETE FROM issue_scores WHERE watched_repo_id = $1`, [
      watchedRepoId,
    ]);
    await pool.query(`DELETE FROM watched_repos WHERE id = $1`, [
      watchedRepoId,
    ]);
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
      userId,
      otherUserId,
    ]);
    await pool.end();
  });

  async function buildService(): Promise<ClaimAssistantService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClaimAssistantService,
        { provide: DRIZZLE, useValue: db },
        { provide: GITHUB_CLIENT, useValue: githubClient },
        { provide: CLAIM_DECISION_PROVIDER, useValue: claimDecisionProvider },
      ],
    }).compile();
    return moduleRef.get(ClaimAssistantService);
  }

  async function seedIssueScore(
    overrides: Partial<typeof issueScores.$inferInsert> = {},
  ) {
    await db.insert(issueScores).values({
      watchedRepoId,
      issueNumber: 1,
      title: 'Fix the flaky test',
      body: 'The upload test fails intermittently under load.',
      url: 'https://github.com/o/r/issues/1',
      state: 'OPEN',
      githubUpdatedAt: new Date(),
      hasAssignee: false,
      openCompetingPrCount: 0,
      sentimentLabel: null,
      score: 90,
      reasons: [],
      ...overrides,
    });
  }

  describe('draftClaim', () => {
    it('abstains without calling the LLM when the gate rejects', async () => {
      await seedIssueScore({ hasAssignee: true });
      const service = await buildService();

      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      expect(draft.status).toBe('abstained');
      expect(draft.gateReasons).toEqual(['ALREADY_ASSIGNED']);
      expect(claimDecisionProvider.calls).toHaveLength(0);
    });

    it('creates a pending_review draft with the LLM comment when the gate passes and the LLM claims', async () => {
      await seedIssueScore();
      claimDecisionProvider.nextResult = {
        decision: 'claim',
        comment: 'I can take a look at the flaky upload test.',
      };
      const service = await buildService();

      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      expect(draft.status).toBe('pending_review');
      expect(draft.gateReasons).toEqual([]);
      expect(draft.draftComment).toBe(
        'I can take a look at the flaky upload test.',
      );
      expect(claimDecisionProvider.calls).toEqual([
        expect.objectContaining({
          issueTitle: 'Fix the flaky test',
          issueBody: 'The upload test fails intermittently under load.',
          repoOwner: 'o',
          repoName: 'r',
        }),
      ]);
    });

    it('abstains (with reason) when the gate passes but the LLM abstains', async () => {
      await seedIssueScore();
      claimDecisionProvider.nextResult = {
        decision: 'abstain',
        reason: 'issue body is too vague',
      };
      const service = await buildService();

      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      expect(draft.status).toBe('abstained');
      expect(draft.llmAbstainReason).toBe('issue body is too vague');
      expect(draft.draftComment).toBeNull();
    });

    it('records a gateSnapshot of what the gate actually saw', async () => {
      await seedIssueScore({
        hasAssignee: false,
        openCompetingPrCount: 0,
        sentimentLabel: 'encouraged',
        score: 77,
      });
      const service = await buildService();

      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      expect(draft.gateSnapshot).toEqual({
        hasAssignee: false,
        openCompetingPrCount: 0,
        sentimentLabel: 'encouraged',
        score: 77,
      });
    });

    it('rejects drafting against a watched repo owned by another user', async () => {
      await seedIssueScore();
      const service = await buildService();

      await expect(
        service.draftClaim(watchedRepoId, 1, otherUserId),
      ).rejects.toThrow(/no watched repo/);
    });

    it('surfaces a unique constraint violation on a second draft for the same issue', async () => {
      // claim_drafts_repo_issue_idx (schema.ts) is what actually stops a
      // double-click or two concurrent requests from creating two drafts
      // for the same issue - draftClaim itself never checks for an
      // existing draft first, so this constraint is the only thing
      // enforcing "one draft per issue". PgExceptionFilter (src/main.ts)
      // maps the resulting 23505 to a 409 at the HTTP layer; this test
      // only confirms the constraint itself actually fires.
      await seedIssueScore();
      const service = await buildService();
      await service.draftClaim(watchedRepoId, 1, userId);

      let thrown: unknown;
      try {
        await service.draftClaim(watchedRepoId, 1, userId);
      } catch (err) {
        thrown = err;
      }
      const cause = (thrown as { cause?: { code?: string } } | undefined)
        ?.cause;
      expect(cause?.code).toBe('23505');
    });
  });

  describe('approve', () => {
    it('posts the draft comment to GitHub and marks the draft posted', async () => {
      await seedIssueScore();
      const service = await buildService();
      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      const approved = await service.approve(draft.id, userId);

      expect(approved.status).toBe('posted');
      expect(approved.postedCommentUrl).toBe(
        'https://github.com/o/r/issues/1#issuecomment-1',
      );
      expect(githubClient.postedComments).toEqual([
        {
          owner: 'o',
          name: 'r',
          issueNumber: 1,
          body: "I'd like to take this on.",
        },
      ]);
    });

    it('re-checks the gate and refuses to post if the issue is no longer safe to claim', async () => {
      await seedIssueScore();
      const service = await buildService();
      const draft = await service.draftClaim(watchedRepoId, 1, userId);
      // The issue got assigned to someone else after the draft was written,
      // but before the user got around to approving it.
      await db
        .update(issueScores)
        .set({ hasAssignee: true })
        .where(eq(issueScores.watchedRepoId, watchedRepoId));

      await expect(service.approve(draft.id, userId)).rejects.toThrow(
        /no longer safe to claim/,
      );
      expect(githubClient.postedComments).toHaveLength(0);
    });

    it('refuses to approve a draft that already has a terminal status', async () => {
      await seedIssueScore();
      const service = await buildService();
      const draft = await service.draftClaim(watchedRepoId, 1, userId);
      await service.reject(draft.id, userId);

      await expect(service.approve(draft.id, userId)).rejects.toThrow(
        /not pending review/,
      );
    });

    it('rejects approving a draft that belongs to another user', async () => {
      await seedIssueScore();
      const service = await buildService();
      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      await expect(service.approve(draft.id, otherUserId)).rejects.toThrow(
        /no claim draft/,
      );
      expect(githubClient.postedComments).toHaveLength(0);
    });
  });

  describe('reject', () => {
    it('marks the draft rejected without touching GitHub', async () => {
      await seedIssueScore();
      const service = await buildService();
      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      const rejected = await service.reject(draft.id, userId);

      expect(rejected.status).toBe('rejected');
      expect(githubClient.postedComments).toHaveLength(0);
    });

    it('rejects rejecting a draft that belongs to another user', async () => {
      await seedIssueScore();
      const service = await buildService();
      const draft = await service.draftClaim(watchedRepoId, 1, userId);

      await expect(service.reject(draft.id, otherUserId)).rejects.toThrow(
        /no claim draft/,
      );
    });
  });

  describe('listDrafts', () => {
    it('lists drafts for a watched repo the user owns', async () => {
      await seedIssueScore();
      const service = await buildService();
      await service.draftClaim(watchedRepoId, 1, userId);

      const drafts = await service.listDrafts(watchedRepoId, userId);

      expect(drafts).toHaveLength(1);
    });

    it('rejects listing drafts for a repo owned by another user', async () => {
      const service = await buildService();

      await expect(
        service.listDrafts(watchedRepoId, otherUserId),
      ).rejects.toThrow(/no watched repo/);
    });
  });
});
