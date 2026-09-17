import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { users } from '../database/schema';
import { FreeTierLimitExceededException } from './free-tier-limit-exceeded.exception';
import { WatchedReposService } from './watched-repos.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('WatchedReposService', () => {
  let service: WatchedReposService;
  let pool: Pool;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`DELETE FROM issue_scores`);
    await pool.query(`DELETE FROM watched_repos`);
    await pool.query(`DELETE FROM users`);

    const db = drizzle(pool, { schema });
    userId = randomUUID();
    otherUserId = randomUUID();
    await db.insert(users).values([
      { id: userId, githubId: `gh-${userId}`, githubLogin: 'octocat' },
      { id: otherUserId, githubId: `gh-${otherUserId}`, githubLogin: 'hubot' },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [WatchedReposService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = moduleRef.get(WatchedReposService);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('starts empty', async () => {
    expect(await service.listWatchedRepos(userId)).toEqual([]);
  });

  it('adds a repo with the default label filter when none is given', async () => {
    const repo = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );

    expect(repo).toMatchObject({
      userId,
      owner: 'fluxcd',
      name: 'source-controller',
      labelFilter: ['good first issue'],
      lastRefreshedAt: null,
    });
  });

  it('adds a repo with a custom label filter', async () => {
    const repo = await service.addWatchedRepo(
      userId,
      'free',
      'argoproj',
      'argo-cd',
      ['good first issue', 'help wanted'],
    );

    expect(repo.labelFilter).toEqual(['good first issue', 'help wanted']);
  });

  it('is idempotent for the same owner/name - returns the existing row instead of duplicating', async () => {
    const first = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );
    const second = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );

    expect(second.id).toBe(first.id);
    expect(await service.listWatchedRepos(userId)).toHaveLength(1);
  });

  it('reads a repo back by id', async () => {
    const created = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );

    const found = await service.getWatchedRepo(created.id, userId);

    expect(found).toMatchObject({ owner: 'fluxcd', name: 'source-controller' });
  });

  it('throws NotFoundException for an unknown id', async () => {
    await expect(
      service.getWatchedRepo('does-not-exist', userId),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for another user's repo", async () => {
    const created = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );

    await expect(
      service.getWatchedRepo(created.id, otherUserId),
    ).rejects.toThrow(NotFoundException);
  });

  it('removes a repo', async () => {
    const created = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );

    await service.removeWatchedRepo(created.id, userId);

    expect(await service.listWatchedRepos(userId)).toEqual([]);
  });

  it('throws NotFoundException removing an unknown id', async () => {
    await expect(
      service.removeWatchedRepo('does-not-exist', userId),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException removing another user's repo (does not delete it)", async () => {
    const created = await service.addWatchedRepo(
      userId,
      'free',
      'fluxcd',
      'source-controller',
    );

    await expect(
      service.removeWatchedRepo(created.id, otherUserId),
    ).rejects.toThrow(NotFoundException);
    expect(await service.listWatchedRepos(userId)).toHaveLength(1);
  });

  describe('free-tier limit', () => {
    it('rejects a 6th repo on the free tier', async () => {
      await service.addWatchedRepo(userId, 'free', 'o', 'r1');
      await service.addWatchedRepo(userId, 'free', 'o', 'r2');
      await service.addWatchedRepo(userId, 'free', 'o', 'r3');
      await service.addWatchedRepo(userId, 'free', 'o', 'r4');
      await service.addWatchedRepo(userId, 'free', 'o', 'r5');

      await expect(
        service.addWatchedRepo(userId, 'free', 'o', 'r6'),
      ).rejects.toThrow(FreeTierLimitExceededException);
      expect(await service.listWatchedRepos(userId)).toHaveLength(5);
    });

    it('does not count re-adding an already-watched repo against the limit', async () => {
      await service.addWatchedRepo(userId, 'free', 'o', 'r1');
      await service.addWatchedRepo(userId, 'free', 'o', 'r2');
      await service.addWatchedRepo(userId, 'free', 'o', 'r3');
      await service.addWatchedRepo(userId, 'free', 'o', 'r4');
      await service.addWatchedRepo(userId, 'free', 'o', 'r5');

      await expect(
        service.addWatchedRepo(userId, 'free', 'o', 'r1'),
      ).resolves.toMatchObject({ owner: 'o', name: 'r1' });
    });

    it('allows more than 5 repos on the pro tier', async () => {
      await service.addWatchedRepo(userId, 'pro', 'o', 'r1');
      await service.addWatchedRepo(userId, 'pro', 'o', 'r2');
      await service.addWatchedRepo(userId, 'pro', 'o', 'r3');
      await service.addWatchedRepo(userId, 'pro', 'o', 'r4');
      await service.addWatchedRepo(userId, 'pro', 'o', 'r5');

      await expect(
        service.addWatchedRepo(userId, 'pro', 'o', 'r6'),
      ).resolves.toMatchObject({ owner: 'o', name: 'r6' });
      expect(await service.listWatchedRepos(userId)).toHaveLength(6);
    });

    it("does not count another user's repos against this user's limit", async () => {
      await service.addWatchedRepo(otherUserId, 'free', 'o', 'r1');
      await service.addWatchedRepo(otherUserId, 'free', 'o', 'r2');
      await service.addWatchedRepo(otherUserId, 'free', 'o', 'r3');
      await service.addWatchedRepo(otherUserId, 'free', 'o', 'r4');
      await service.addWatchedRepo(otherUserId, 'free', 'o', 'r5');

      await expect(
        service.addWatchedRepo(userId, 'free', 'o', 'r1'),
      ).resolves.toMatchObject({ owner: 'o', name: 'r1' });
    });
  });
});
