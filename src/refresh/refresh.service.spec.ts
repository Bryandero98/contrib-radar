import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AlertsService, type NewIssueAlert } from '../alerts/alerts.service';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { issueScores, users, watchedRepos } from '../database/schema';
import type {
  FetchIssuesForScoringParams,
  GithubClient,
  GithubIssue,
} from '../github/github-client.interface';
import { GITHUB_CLIENT } from '../github/github.module';
import { ScoringService } from '../scoring/scoring.service';
import type {
  SentimentProvider,
  SentimentResult,
} from '../sentiment/sentiment-provider.interface';
import { SENTIMENT_PROVIDER } from '../sentiment/sentiment.module';
import { RefreshService } from './refresh.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

function fakeIssue(overrides: Partial<GithubIssue> = {}): GithubIssue {
  return {
    number: 1,
    title: 'Fake issue',
    url: 'https://github.com/o/r/issues/1',
    state: 'OPEN',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    labels: [],
    assigneeLogins: [],
    comments: [],
    crossReferencingPullRequests: [],
    maintainerCommentsFullyChecked: true,
    ...overrides,
  };
}

// Test doubles implementing the small provider interfaces directly, rather
// than mocking fetch - the HTTP contract with GitHub/Gemini is already
// covered by github-graphql.provider.spec.ts and
// gemini-sentiment.provider.spec.ts. This spec is about orchestration,
// persistence, and the refresh cooldown, which don't need real network
// mocking to exercise.
class FakeGithubClient implements GithubClient {
  issues: GithubIssue[] = [fakeIssue()];
  calls: FetchIssuesForScoringParams[] = [];

  fetchIssuesForScoring(
    params: FetchIssuesForScoringParams,
  ): Promise<GithubIssue[]> {
    this.calls.push(params);
    return Promise.resolve(this.issues);
  }

  fetchSingleIssueForScoring(): Promise<GithubIssue | null> {
    return Promise.resolve(this.issues[0] ?? null);
  }
}

class FakeSentimentProvider implements SentimentProvider {
  readonly name = 'fake';
  classify(): Promise<SentimentResult> {
    return Promise.resolve({ label: 'neutral', rationale: 'fake' });
  }
}

class FakeAlertsService extends AlertsService {
  calls: { webhookUrl: string; issues: NewIssueAlert[] }[] = [];
  override notifyNewIssues(
    webhookUrl: string,
    issues: NewIssueAlert[],
  ): Promise<void> {
    this.calls.push({ webhookUrl, issues });
    return Promise.resolve();
  }
}

describeIfDb('RefreshService', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let githubClient: FakeGithubClient;
  let watchedRepoId: string;
  let userId: string;
  let alertsService: FakeAlertsService;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      githubId: `gh-${userId}`,
      githubLogin: 'octocat',
    });
    watchedRepoId = randomUUID();
    await db.insert(watchedRepos).values({
      id: watchedRepoId,
      userId,
      owner: 'o',
      name: 'r',
      labelFilter: ['good first issue'],
    });

    githubClient = new FakeGithubClient();
    alertsService = new FakeAlertsService();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM issue_scores WHERE watched_repo_id = $1`, [
      watchedRepoId,
    ]);
    await pool.query(`DELETE FROM watched_repos WHERE id = $1`, [
      watchedRepoId,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  });

  async function buildService(
    sentimentProvider: SentimentProvider = new FakeSentimentProvider(),
  ): Promise<RefreshService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RefreshService,
        ScoringService,
        { provide: DRIZZLE, useValue: db },
        { provide: GITHUB_CLIENT, useValue: githubClient },
        { provide: SENTIMENT_PROVIDER, useValue: sentimentProvider },
        { provide: AlertsService, useValue: alertsService },
      ],
    }).compile();
    return moduleRef.get(RefreshService);
  }

  it('fetches issues, scores them, and upserts issue_scores', async () => {
    const service = await buildService();

    const result = await service.refreshWatchedRepo(watchedRepoId, userId);

    expect(result).toEqual({ refreshed: true, issueCount: 1 });
    expect(githubClient.calls).toEqual([
      { owner: 'o', name: 'r', labels: ['good first issue'] },
    ]);
    const [row] = await db
      .select()
      .from(issueScores)
      .where(eq(issueScores.watchedRepoId, watchedRepoId));
    expect(row.score).toBe(100);
    expect(row.sentimentLabel).toBeNull(); // no maintainer comments -> classifySafely never calls the provider
  });

  it('throws NotFoundException for an unknown watched repo id', async () => {
    const service = await buildService();

    await expect(
      service.refreshWatchedRepo(randomUUID(), userId),
    ).rejects.toThrow(/no watched repo/);
  });

  it("throws NotFoundException for another user's watched repo id", async () => {
    const service = await buildService();

    await expect(
      service.refreshWatchedRepo(watchedRepoId, randomUUID()),
    ).rejects.toThrow(/no watched repo/);
  });

  it('is idempotent on re-run (upsert, not duplicate rows)', async () => {
    const service = await buildService();
    await service.refreshWatchedRepo(watchedRepoId, userId);
    // Bypass the cooldown directly to isolate upsert behavior from
    // cooldown behavior (the latter is tested separately below).
    await pool.query(
      `UPDATE watched_repos SET last_refreshed_at = NULL WHERE id = $1`,
      [watchedRepoId],
    );

    await service.refreshWatchedRepo(watchedRepoId, userId);

    const rows = await db
      .select()
      .from(issueScores)
      .where(eq(issueScores.watchedRepoId, watchedRepoId));
    expect(rows).toHaveLength(1);
  });

  it('drops stale issue_scores rows for issues no longer in the fetch result (closed, unlabeled, reassigned)', async () => {
    // Real bug found in production (argoproj/argo-cd#3040): a maintainer
    // closed/rejected the issue, but its issue_scores row - scored while it
    // was still open - never got touched again because the states:OPEN
    // GraphQL query correctly stopped returning it. It sat there forever
    // with a stale score of 100, outranking every real open opportunity.
    githubClient.issues = [fakeIssue({ number: 1 }), fakeIssue({ number: 2 })];
    const service = await buildService();
    await service.refreshWatchedRepo(watchedRepoId, userId);
    await pool.query(
      `UPDATE watched_repos SET last_refreshed_at = NULL WHERE id = $1`,
      [watchedRepoId],
    );
    // #2 closed (or dropped the label) since the last refresh: only #1 comes back now.
    githubClient.issues = [fakeIssue({ number: 1 })];

    const result = await service.refreshWatchedRepo(watchedRepoId, userId);

    expect(result).toEqual({ refreshed: true, issueCount: 1 });
    const rows = await db
      .select()
      .from(issueScores)
      .where(eq(issueScores.watchedRepoId, watchedRepoId));
    expect(rows.map((r) => r.issueNumber)).toEqual([1]);
  });

  it('clears every issue_scores row when the fetch returns no issues at all', async () => {
    const service = await buildService();
    await service.refreshWatchedRepo(watchedRepoId, userId);
    await pool.query(
      `UPDATE watched_repos SET last_refreshed_at = NULL WHERE id = $1`,
      [watchedRepoId],
    );
    githubClient.issues = [];

    const result = await service.refreshWatchedRepo(watchedRepoId, userId);

    expect(result).toEqual({ refreshed: true, issueCount: 0 });
    const rows = await db
      .select()
      .from(issueScores)
      .where(eq(issueScores.watchedRepoId, watchedRepoId));
    expect(rows).toHaveLength(0);
  });

  it('returns the cached snapshot without calling GitHub again inside the cooldown window', async () => {
    const service = await buildService();
    await service.refreshWatchedRepo(watchedRepoId, userId);
    githubClient.calls = [];

    const result = await service.refreshWatchedRepo(watchedRepoId, userId);

    expect(result.refreshed).toBe(false);
    expect(result.issueCount).toBe(1);
    expect(githubClient.calls).toHaveLength(0);
  });

  it('degrades gracefully when the sentiment provider throws, still persisting a deterministic score', async () => {
    githubClient.issues = [
      fakeIssue({
        comments: [
          {
            authorLogin: 'maintainer',
            authorAssociation: 'OWNER',
            body: 'looks good to me',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ];
    const throwingSentiment: SentimentProvider = {
      name: 'broken',
      classify: () => {
        throw new Error('boom');
      },
    };
    const service = await buildService(throwingSentiment);

    const result = await service.refreshWatchedRepo(watchedRepoId, userId);

    expect(result.refreshed).toBe(true);
    const [row] = await db
      .select()
      .from(issueScores)
      .where(eq(issueScores.watchedRepoId, watchedRepoId));
    expect(row.sentimentLabel).toBeNull();
    expect(row.reasons.some((r) => r.code === 'SENTIMENT_UNAVAILABLE')).toBe(
      true,
    );
  });

  describe('new-issue alerts', () => {
    it('does not call the alerts webhook when the user has none configured', async () => {
      const service = await buildService();

      await service.refreshWatchedRepo(watchedRepoId, userId);

      expect(alertsService.calls).toHaveLength(0);
    });

    it('notifies the webhook once for issues new to this refresh, and never again', async () => {
      await db
        .update(users)
        .set({ alertWebhookUrl: 'https://hooks.slack.com/services/x' })
        .where(eq(users.id, userId));
      const service = await buildService();

      await service.refreshWatchedRepo(watchedRepoId, userId);

      expect(alertsService.calls).toHaveLength(1);
      expect(alertsService.calls[0]).toMatchObject({
        webhookUrl: 'https://hooks.slack.com/services/x',
        issues: [expect.objectContaining({ owner: 'o', name: 'r', number: 1 })],
      });

      // Re-running the refresh sees the same issue #1 again - it's not new
      // anymore, so it must not be re-alerted.
      await pool.query(
        `UPDATE watched_repos SET last_refreshed_at = NULL WHERE id = $1`,
        [watchedRepoId],
      );
      await service.refreshWatchedRepo(watchedRepoId, userId);

      expect(alertsService.calls).toHaveLength(1);
    });

    it('only alerts for issues genuinely new to this refresh, not ones already scored', async () => {
      await db
        .update(users)
        .set({ alertWebhookUrl: 'https://hooks.slack.com/services/x' })
        .where(eq(users.id, userId));
      githubClient.issues = [fakeIssue({ number: 1 })];
      const service = await buildService();
      await service.refreshWatchedRepo(watchedRepoId, userId);
      alertsService.calls = [];
      await pool.query(
        `UPDATE watched_repos SET last_refreshed_at = NULL WHERE id = $1`,
        [watchedRepoId],
      );
      // #1 is still there (not new), #2 is genuinely new this time.
      githubClient.issues = [
        fakeIssue({ number: 1 }),
        fakeIssue({ number: 2 }),
      ];

      await service.refreshWatchedRepo(watchedRepoId, userId);

      expect(alertsService.calls).toHaveLength(1);
      expect(alertsService.calls[0].issues.map((i) => i.number)).toEqual([2]);
    });
  });

  describe('scoreSingleIssue', () => {
    it('scores a single issue live, without touching the DB', async () => {
      const service = await buildService();

      const result = await service.scoreSingleIssue('o', 'r', 1);

      expect(result?.score).toBe(100);
      const rows = await db
        .select()
        .from(issueScores)
        .where(eq(issueScores.watchedRepoId, watchedRepoId));
      expect(rows).toHaveLength(0);
    });

    it('returns null when the issue does not exist', async () => {
      githubClient.issues = [];
      const service = await buildService();

      const result = await service.scoreSingleIssue('o', 'r', 999);

      expect(result).toBeNull();
    });
  });
});
