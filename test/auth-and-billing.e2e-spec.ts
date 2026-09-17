import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import type Stripe from 'stripe';
import { AppModule } from './../src/app.module';
import { GITHUB_OAUTH_CLIENT } from './../src/auth/github-oauth-client.token';
import type { GithubOauthClient } from './../src/auth/github-oauth-client.interface';
import { STRIPE_CLIENT } from './../src/billing/stripe-client.token';
import { GITHUB_CLIENT } from './../src/github/github.module';
import type {
  GithubClient,
  GithubIssue,
} from './../src/github/github-client.interface';
import type { SentimentProvider } from './../src/sentiment/sentiment-provider.interface';
import { SENTIMENT_PROVIDER } from './../src/sentiment/sentiment.module';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

class FakeGithubClient implements GithubClient {
  fetchIssuesForScoring(): Promise<GithubIssue[]> {
    return Promise.resolve([]);
  }
  fetchSingleIssueForScoring(): Promise<GithubIssue | null> {
    return Promise.resolve(null);
  }
}

class FakeSentimentProvider implements SentimentProvider {
  readonly name = 'fake';
  classify() {
    return Promise.resolve({ label: 'neutral' as const, rationale: 'fake' });
  }
}

// A fake OAuth provider keyed by the `code` the caller sends - lets each
// test log in as a distinct GitHub identity without hitting github.com.
class FakeGithubOauthClient implements GithubOauthClient {
  private nextGithubId = 1;

  getAuthorizeUrl(state: string): string {
    return `https://github.example/authorize?state=${state}`;
  }

  exchangeCodeForProfile(code: string) {
    const githubId = String(this.nextGithubId++);
    return Promise.resolve({
      githubId,
      githubLogin: `fake-user-${code}`,
      avatarUrl: null,
    });
  }
}

function extractCookie(setCookieHeader: string[], name: string): string {
  const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`cookie "${name}" not set`);
  return raw.split(';')[0];
}

async function ownerOfWatchedRepo(
  pool: Pool,
  watchedRepoId: string,
): Promise<string> {
  const result = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM watched_repos WHERE id = $1',
    [watchedRepoId],
  );
  return result.rows[0].user_id;
}

describeIfDb('auth + billing (e2e)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  let stripe: Stripe;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    stripe = {
      checkout: { sessions: { create: jest.fn() } },
      webhooks: { constructEvent: jest.fn() },
    } as unknown as Stripe;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GITHUB_CLIENT)
      .useValue(new FakeGithubClient())
      .overrideProvider(SENTIMENT_PROVIDER)
      .useValue(new FakeSentimentProvider())
      .overrideProvider(GITHUB_OAUTH_CLIENT)
      .useValue(new FakeGithubOauthClient())
      .overrideProvider(STRIPE_CLIENT)
      .useValue(stripe)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await pool.query(
        'DELETE FROM issue_scores WHERE watched_repo_id IN (SELECT id FROM watched_repos WHERE user_id = $1)',
        [userId],
      );
      await pool.query('DELETE FROM watched_repos WHERE user_id = $1', [
        userId,
      ]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app.close();
    await pool.end();
  });

  // Logs in via the real /auth/github -> /auth/github/callback redirect
  // dance (state cookie + query param round-trip), against the fake OAuth
  // provider - only github.com itself is faked, everything else is real.
  async function loginAs(loginCode: string): Promise<string> {
    const startRes = await request(app.getHttpServer())
      .get('/auth/github')
      .expect(302);
    const stateCookie = extractCookie(
      startRes.headers['set-cookie'] as unknown as string[],
      'oauth_state',
    );
    const state = new URL(startRes.headers.location).searchParams.get('state');

    const callbackRes = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=${loginCode}&state=${state}`)
      .set('Cookie', stateCookie)
      .expect(302)
      .expect('Location', '/dashboard');

    return extractCookie(
      callbackRes.headers['set-cookie'] as unknown as string[],
      'session',
    );
  }

  it('logs a new user in and lets them add a repo', async () => {
    const sessionCookie = await loginAs('alice');

    const meRepos = await request(app.getHttpServer())
      .get('/repos')
      .set('Cookie', sessionCookie)
      .expect(200);
    expect(meRepos.body).toEqual([]);

    const added = await request(app.getHttpServer())
      .post('/repos')
      .set('Cookie', sessionCookie)
      .send({ owner: 'o', name: 'r' })
      .expect(201);
    createdUserIds.push(
      await ownerOfWatchedRepo(pool, (added.body as { id: string }).id),
    );

    expect(added.body).toMatchObject({ owner: 'o', name: 'r' });
  });

  it('rejects the callback when the state does not match (CSRF)', async () => {
    await request(app.getHttpServer()).get('/auth/github').expect(302);

    await request(app.getHttpServer())
      .get('/auth/github/callback?code=alice&state=wrong-state')
      .set('Cookie', 'oauth_state=expected-state')
      .expect(400);
  });

  it("keeps two identities' watched repos separate", async () => {
    const aliceCookie = await loginAs('alice');
    const bobCookie = await loginAs('bob');

    const aliceRepo = await request(app.getHttpServer())
      .post('/repos')
      .set('Cookie', aliceCookie)
      .send({ owner: 'alice-org', name: 'alice-repo' })
      .expect(201);
    const bobRepo = await request(app.getHttpServer())
      .post('/repos')
      .set('Cookie', bobCookie)
      .send({ owner: 'bob-org', name: 'bob-repo' })
      .expect(201);

    createdUserIds.push(
      await ownerOfWatchedRepo(pool, (aliceRepo.body as { id: string }).id),
      await ownerOfWatchedRepo(pool, (bobRepo.body as { id: string }).id),
    );

    const aliceList = await request(app.getHttpServer())
      .get('/repos')
      .set('Cookie', aliceCookie)
      .expect(200);
    expect(aliceList.body).toHaveLength(1);
    expect((aliceList.body as { name: string }[])[0].name).toBe('alice-repo');

    // Bob can't reach Alice's repo by id either.
    await request(app.getHttpServer())
      .get(`/repos/${(aliceRepo.body as { id: string }).id}`)
      .set('Cookie', bobCookie)
      .expect(404);
  });

  it('caps the free tier at 5 repos and unlocks the 6th after a simulated Stripe upgrade', async () => {
    const sessionCookie = await loginAs('carol');
    let userId = '';

    for (const name of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      const res = await request(app.getHttpServer())
        .post('/repos')
        .set('Cookie', sessionCookie)
        .send({ owner: 'o', name })
        .expect(201);
      userId = await ownerOfWatchedRepo(pool, (res.body as { id: string }).id);
    }
    createdUserIds.push(userId);

    const sixthAttempt = await request(app.getHttpServer())
      .post('/repos')
      .set('Cookie', sessionCookie)
      .send({ owner: 'o', name: 'r6' })
      .expect(403);
    expect((sixthAttempt.body as { code?: string }).code).toBe(
      'FREE_TIER_LIMIT_EXCEEDED',
    );

    // Simulate Stripe telling us the checkout completed - the webhook has
    // no session guard, only the (faked) signature check.
    (stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: userId,
          customer: 'cus_test',
          subscription: 'sub_test',
        },
      },
    });
    await request(app.getHttpServer())
      .post('/billing/webhook')
      .set('stripe-signature', 'irrelevant-fake-checks-it-not-this-test')
      .send(Buffer.from('{}'))
      .type('application/json')
      .expect(200);

    await request(app.getHttpServer())
      .post('/repos')
      .set('Cookie', sessionCookie)
      .send({ owner: 'o', name: 'r6' })
      .expect(201);
  });

  describe('MCP (X-Api-Key)', () => {
    it('rejects a request with no API key', () => {
      return request(app.getHttpServer())
        .post('/mcp')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
        .expect(401);
    });

    it('rejects an invalid API key', () => {
      return request(app.getHttpServer())
        .post('/mcp')
        .set('X-Api-Key', 'cr_not-a-real-key')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
        .expect(401);
    });

    it("only sees the key owner's repos via list_watched_repos", async () => {
      const sessionCookie = await loginAs('dave');
      const added = await request(app.getHttpServer())
        .post('/repos')
        .set('Cookie', sessionCookie)
        .send({ owner: 'o', name: 'dave-repo' })
        .expect(201);
      const userId = await ownerOfWatchedRepo(
        pool,
        (added.body as { id: string }).id,
      );
      createdUserIds.push(userId);

      const keyRes = await request(app.getHttpServer())
        .post('/users/me/api-key')
        .set('Cookie', sessionCookie)
        .expect(200);
      const apiKey = (keyRes.body as { apiKey: string }).apiKey;

      const mcpRes = await request(app.getHttpServer())
        .post('/mcp')
        .set('X-Api-Key', apiKey)
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'list_watched_repos', arguments: {} },
          id: 1,
        })
        .expect(200);

      // The MCP Streamable HTTP transport may respond as SSE
      // (text/event-stream), which supertest doesn't parse into
      // res.body - res.text has the raw payload either way.
      expect(mcpRes.text).toContain('dave-repo');
    });
  });
});
