import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { GITHUB_CLIENT } from './../src/github/github.module';
import type {
  FetchIssuesForScoringParams,
  GithubClient,
  GithubIssue,
} from './../src/github/github-client.interface';
import type { SentimentProvider } from './../src/sentiment/sentiment-provider.interface';
import { SENTIMENT_PROVIDER } from './../src/sentiment/sentiment.module';

// Full add-repo -> refresh -> read-back flow over real HTTP against a
// real Postgres. GITHUB_CLIENT/SENTIMENT_PROVIDER are overridden with test
// doubles - this suite must never call the real GitHub/Gemini APIs, in CI
// or anywhere else. Skipped entirely when DATABASE_URL isn't set.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

function fakeIssue(overrides: Partial<GithubIssue> = {}): GithubIssue {
  return {
    number: 42,
    title: 'Add a retry to the flaky upload step',
    url: 'https://github.com/o/r/issues/42',
    state: 'OPEN',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    labels: ['good first issue'],
    assigneeLogins: [],
    comments: [
      {
        authorLogin: 'a-maintainer',
        authorAssociation: 'OWNER',
        body: 'This would be a great first contribution, happy to review a PR.',
        createdAt: new Date().toISOString(),
      },
    ],
    crossReferencingPullRequests: [],
    maintainerCommentsFullyChecked: true,
    ...overrides,
  };
}

class FakeGithubClient implements GithubClient {
  calls: FetchIssuesForScoringParams[] = [];

  fetchIssuesForScoring(
    params: FetchIssuesForScoringParams,
  ): Promise<GithubIssue[]> {
    this.calls.push(params);
    return Promise.resolve([fakeIssue()]);
  }

  fetchSingleIssueForScoring(): Promise<GithubIssue | null> {
    return Promise.resolve(fakeIssue());
  }
}

class FakeSentimentProvider implements SentimentProvider {
  readonly name = 'fake';
  classify() {
    return Promise.resolve({
      label: 'encouraged' as const,
      rationale: 'Maintainer said this would be a great first contribution.',
    });
  }
}

interface ScoredIssueRow {
  issueNumber: number;
  title: string;
  sentimentLabel: string | null;
  score: number;
}

describeIfDb('contrib-radar core flow (e2e)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  let watchedRepoId: string | undefined;
  const githubClient = new FakeGithubClient();

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GITHUB_CLIENT)
      .useValue(githubClient)
      .overrideProvider(SENTIMENT_PROVIDER)
      .useValue(new FakeSentimentProvider())
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (watchedRepoId) {
      await pool.query('DELETE FROM issue_scores WHERE watched_repo_id = $1', [
        watchedRepoId,
      ]);
      await pool.query('DELETE FROM watched_repos WHERE id = $1', [
        watchedRepoId,
      ]);
      watchedRepoId = undefined;
    }
    await app.close();
    await pool.end();
  });

  it('adds a repo, refreshes it, and reads the scored issue back', async () => {
    const addResponse = await request(app.getHttpServer())
      .post('/repos')
      .send({ owner: 'e2e-org', name: 'e2e-repo' })
      .expect(201);
    const addedRepo = addResponse.body as { id: string };
    watchedRepoId = addedRepo.id;
    expect(addResponse.body).toMatchObject({
      owner: 'e2e-org',
      name: 'e2e-repo',
      labelFilter: ['good first issue'],
    });

    const refreshResponse = await request(app.getHttpServer())
      .post(`/repos/${watchedRepoId}/refresh`)
      .expect(200);
    expect(refreshResponse.body).toEqual({ refreshed: true, issueCount: 1 });
    expect(githubClient.calls).toEqual([
      { owner: 'e2e-org', name: 'e2e-repo', labels: ['good first issue'] },
    ]);

    const issuesResponse = await request(app.getHttpServer())
      .get(`/repos/${watchedRepoId}/issues`)
      .expect(200);
    const scoredIssues = issuesResponse.body as ScoredIssueRow[];
    expect(scoredIssues).toHaveLength(1);
    expect(scoredIssues[0]).toMatchObject({
      issueNumber: 42,
      title: 'Add a retry to the flaky upload step',
      sentimentLabel: 'encouraged',
    });
    expect(scoredIssues[0].score).toBeGreaterThan(90);

    // A second refresh inside the 5-minute cooldown must not call GitHub
    // again, and must still return the same snapshot.
    const cooldownResponse = await request(app.getHttpServer())
      .post(`/repos/${watchedRepoId}/refresh`)
      .expect(200);
    expect(cooldownResponse.body).toEqual({
      refreshed: false,
      issueCount: 1,
    });
    expect(githubClient.calls).toHaveLength(1);
  });

  it('returns 404 for an unknown watched repo id on refresh', () => {
    return request(app.getHttpServer())
      .post('/repos/00000000-0000-0000-0000-000000000000/refresh')
      .expect(404);
  });

  it('serves the dashboard as HTML', () => {
    return request(app.getHttpServer())
      .get('/dashboard')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect(/contrib-radar/);
  });
});
