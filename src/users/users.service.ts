import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import { users } from '../database/schema';

export interface GithubProfile {
  githubId: string;
  githubLogin: string;
  avatarUrl: string | null;
}

export interface StripeTierUpdate {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string | null;
}

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

// sha256, not bcrypt/argon2: the API key is a 256-bit random token, not a
// low-entropy user-chosen password, so a slow KDF buys nothing here and
// would add a dependency for no benefit - same reasoning as packetforge's
// own token-hashing code.
@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // Upserted by githubId on every login, so a GitHub username/avatar change
  // is picked up automatically instead of freezing the profile at first login.
  async findOrCreateByGithub(profile: GithubProfile) {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.githubId, profile.githubId));

    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({
          githubLogin: profile.githubLogin,
          avatarUrl: profile.avatarUrl,
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(users)
      .values({
        id: randomUUID(),
        githubId: profile.githubId,
        githubLogin: profile.githubLogin,
        avatarUrl: profile.avatarUrl,
      })
      .returning();
    return created;
  }

  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user ?? null;
  }

  async findByApiKeyHash(apiKeyHash: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.apiKeyHash, apiKeyHash));
    return user ?? null;
  }

  async findByStripeCustomerId(stripeCustomerId: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, stripeCustomerId));
    return user ?? null;
  }

  // Returns the raw key exactly once - only the hash is ever persisted.
  // Regenerating silently invalidates whatever key existed before (a single
  // unique index on apiKeyHash makes a stale one unusable anyway).
  async generateApiKey(userId: string): Promise<string> {
    const rawKey = `cr_${randomBytes(32).toString('base64url')}`;
    await this.db
      .update(users)
      .set({ apiKeyHash: hashApiKey(rawKey) })
      .where(eq(users.id, userId));
    return rawKey;
  }

  async findByApiKey(rawKey: string) {
    return this.findByApiKeyHash(hashApiKey(rawKey));
  }

  async setTier(
    userId: string,
    tier: 'free' | 'pro',
    stripeIds?: StripeTierUpdate,
  ) {
    const [updated] = await this.db
      .update(users)
      .set({ tier, ...stripeIds })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }
}
