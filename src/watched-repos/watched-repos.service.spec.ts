import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { WatchedReposService } from './watched-repos.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('WatchedReposService', () => {
  let service: WatchedReposService;
  let pool: Pool;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`DELETE FROM issue_scores`);
    await pool.query(`DELETE FROM watched_repos`);

    const moduleRef = await Test.createTestingModule({
      providers: [
        WatchedReposService,
        { provide: DRIZZLE, useValue: drizzle(pool, { schema }) },
      ],
    }).compile();
    service = moduleRef.get(WatchedReposService);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('starts empty', async () => {
    expect(await service.listWatchedRepos()).toEqual([]);
  });

  it('adds a repo with the default label filter when none is given', async () => {
    const repo = await service.addWatchedRepo('fluxcd', 'source-controller');

    expect(repo).toMatchObject({
      owner: 'fluxcd',
      name: 'source-controller',
      labelFilter: ['good first issue'],
      lastRefreshedAt: null,
    });
  });

  it('adds a repo with a custom label filter', async () => {
    const repo = await service.addWatchedRepo('argoproj', 'argo-cd', [
      'good first issue',
      'help wanted',
    ]);

    expect(repo.labelFilter).toEqual(['good first issue', 'help wanted']);
  });

  it('is idempotent for the same owner/name - returns the existing row instead of duplicating', async () => {
    const first = await service.addWatchedRepo('fluxcd', 'source-controller');
    const second = await service.addWatchedRepo('fluxcd', 'source-controller');

    expect(second.id).toBe(first.id);
    expect(await service.listWatchedRepos()).toHaveLength(1);
  });

  it('reads a repo back by id', async () => {
    const created = await service.addWatchedRepo('fluxcd', 'source-controller');

    const found = await service.getWatchedRepo(created.id);

    expect(found).toMatchObject({ owner: 'fluxcd', name: 'source-controller' });
  });

  it('throws NotFoundException for an unknown id', async () => {
    await expect(service.getWatchedRepo('does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('removes a repo', async () => {
    const created = await service.addWatchedRepo('fluxcd', 'source-controller');

    await service.removeWatchedRepo(created.id);

    expect(await service.listWatchedRepos()).toEqual([]);
  });

  it('throws NotFoundException removing an unknown id', async () => {
    await expect(service.removeWatchedRepo('does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });
});
