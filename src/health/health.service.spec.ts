import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { HealthService } from './health.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('HealthService', () => {
  let service: HealthService;
  let pool: Pool;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DRIZZLE, useValue: drizzle(pool, { schema }) },
      ],
    }).compile();
    service = moduleRef.get(HealthService);
  });

  afterEach(async () => {
    await pool.end();
    restoreEnv('GITHUB_TOKEN', originalGithubToken);
    restoreEnv('GEMINI_API_KEY', originalGeminiKey);
  });

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  it('reports ok with a real, reachable database', async () => {
    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks.database).toBe('ok');
  });

  it('reports githubToken/sentimentProvider as not-configured when unset', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GEMINI_API_KEY;

    const result = await service.check();

    expect(result.checks.githubToken).toBe('not-configured');
    expect(result.checks.sentimentProvider).toBe('not-configured');
  });

  it('reports githubToken/sentimentProvider as configured when set', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GEMINI_API_KEY = 'test-key';

    const result = await service.check();

    expect(result.checks.githubToken).toBe('configured');
    expect(result.checks.sentimentProvider).toBe('configured');
  });

  it('reports error, not a thrown exception, when the database is unreachable', async () => {
    const badPool = new Pool({
      connectionString: 'postgresql://user:pass@127.0.0.1:1/nonexistent',
      connectionTimeoutMillis: 500,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DRIZZLE, useValue: drizzle(badPool, { schema }) },
      ],
    }).compile();
    const brokenService = moduleRef.get(HealthService);

    const result = await brokenService.check();

    expect(result.status).toBe('error');
    expect(result.checks.database).toBe('error');
    await badPool.end();
  });
});
