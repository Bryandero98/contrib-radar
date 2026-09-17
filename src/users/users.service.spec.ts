import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { UsersService } from './users.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('UsersService', () => {
  let service: UsersService;
  let pool: Pool;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`DELETE FROM watched_repos`);
    await pool.query(`DELETE FROM users`);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DRIZZLE, useValue: drizzle(pool, { schema }) },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('findOrCreateByGithub', () => {
    it('creates a new user on first login, defaulting to the free tier', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: 'https://example.com/a.png',
      });

      expect(user).toMatchObject({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: 'https://example.com/a.png',
        tier: 'free',
      });
    });

    it('is idempotent by githubId - same user, updated login/avatar', async () => {
      const first = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });

      const second = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat-renamed',
        avatarUrl: 'https://example.com/new.png',
      });

      expect(second.id).toBe(first.id);
      expect(second.githubLogin).toBe('octocat-renamed');
      expect(second.avatarUrl).toBe('https://example.com/new.png');
    });
  });

  describe('findById / findByStripeCustomerId', () => {
    it('returns null for an unknown id', async () => {
      expect(await service.findById('does-not-exist')).toBeNull();
    });

    it('finds a user by their Stripe customer id after setTier sets it', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });
      await service.setTier(user.id, 'pro', { stripeCustomerId: 'cus_123' });

      const found = await service.findByStripeCustomerId('cus_123');

      expect(found?.id).toBe(user.id);
      expect(found?.tier).toBe('pro');
    });
  });

  describe('API key lifecycle', () => {
    it('generates a key whose sha256 hash matches what is persisted', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });

      const rawKey = await service.generateApiKey(user.id);

      expect(rawKey).toMatch(/^cr_/);
      const expectedHash = createHash('sha256').update(rawKey).digest('hex');
      const found = await service.findByApiKeyHash(expectedHash);
      expect(found?.id).toBe(user.id);
    });

    it('finds a user by the raw key via findByApiKey', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });
      const rawKey = await service.generateApiKey(user.id);

      const found = await service.findByApiKey(rawKey);

      expect(found?.id).toBe(user.id);
    });

    it('invalidates the old key when a new one is generated (rotation)', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });
      const firstKey = await service.generateApiKey(user.id);
      const secondKey = await service.generateApiKey(user.id);

      expect(await service.findByApiKey(firstKey)).toBeNull();
      expect((await service.findByApiKey(secondKey))?.id).toBe(user.id);
    });

    it('returns null for a key that was never generated', async () => {
      expect(await service.findByApiKey('cr_not-a-real-key')).toBeNull();
    });
  });

  describe('setTier', () => {
    it('upgrades to pro with Stripe ids', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });

      const updated = await service.setTier(user.id, 'pro', {
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
      });

      expect(updated).toMatchObject({
        tier: 'pro',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
      });
    });

    it('downgrades to free, leaving the Stripe customer id in place', async () => {
      const user = await service.findOrCreateByGithub({
        githubId: '123',
        githubLogin: 'octocat',
        avatarUrl: null,
      });
      await service.setTier(user.id, 'pro', { stripeCustomerId: 'cus_123' });

      const downgraded = await service.setTier(user.id, 'free');

      expect(downgraded.tier).toBe('free');
      expect(downgraded.stripeCustomerId).toBe('cus_123');
    });
  });
});
