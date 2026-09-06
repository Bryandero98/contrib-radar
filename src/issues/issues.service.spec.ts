import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../database/schema';
import {
  issueScores,
  watchedRepos,
  type ScoreReason,
} from '../database/schema';
import { IssuesService } from './issues.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const noReasons: ScoreReason[] = [];

describeIfDb('IssuesService', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: IssuesService;
  let watchedRepoId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    service = new IssuesService(db);
    watchedRepoId = randomUUID();

    await db.insert(watchedRepos).values({
      id: watchedRepoId,
      owner: 'o',
      name: 'r',
      labelFilter: ['good first issue'],
    });
    await db.insert(issueScores).values([
      {
        watchedRepoId,
        issueNumber: 1,
        title: 'Low score, recently updated',
        url: 'https://github.com/o/r/issues/1',
        state: 'OPEN',
        githubUpdatedAt: new Date('2026-09-05T00:00:00Z'),
        score: 20,
        reasons: noReasons,
      },
      {
        watchedRepoId,
        issueNumber: 2,
        title: 'High score, older',
        url: 'https://github.com/o/r/issues/2',
        state: 'OPEN',
        githubUpdatedAt: new Date('2026-08-01T00:00:00Z'),
        score: 90,
        reasons: noReasons,
      },
    ]);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM issue_scores WHERE watched_repo_id = $1`, [
      watchedRepoId,
    ]);
    await pool.query(`DELETE FROM watched_repos WHERE id = $1`, [
      watchedRepoId,
    ]);
    await pool.end();
  });

  it('defaults to score descending', async () => {
    const rows = await service.listScoredIssues(watchedRepoId);

    expect(rows.map((r) => r.issueNumber)).toEqual([2, 1]);
  });

  it('sorts by most-recently-updated when asked', async () => {
    const rows = await service.listScoredIssues(watchedRepoId, 'updated');

    expect(rows.map((r) => r.issueNumber)).toEqual([1, 2]);
  });

  it('only returns issues for the requested repo', async () => {
    const otherRows = await service.listScoredIssues(randomUUID());

    expect(otherRows).toHaveLength(0);
  });
});
