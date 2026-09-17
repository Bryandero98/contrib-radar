import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import { watchedRepos } from '../database/schema';
import { FreeTierLimitExceededException } from './free-tier-limit-exceeded.exception';

const DEFAULT_LABEL_FILTER = ['good first issue'];
const FREE_TIER_WATCHED_REPO_LIMIT = 5;

@Injectable()
export class WatchedReposService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listWatchedRepos(userId: string) {
    return this.db
      .select()
      .from(watchedRepos)
      .where(eq(watchedRepos.userId, userId));
  }

  async getWatchedRepo(id: string, userId: string) {
    const [repo] = await this.db
      .select()
      .from(watchedRepos)
      .where(and(eq(watchedRepos.id, id), eq(watchedRepos.userId, userId)));
    if (!repo) {
      // Same 404 whether the id doesn't exist or belongs to another user -
      // deliberately not distinguishing the two, so this never leaks
      // whether a given id is someone else's repo.
      throw new NotFoundException(`no watched repo with id "${id}"`);
    }
    return repo;
  }

  // Idempotent by (userId, owner, name): a double-click on "add repo" in
  // the dashboard, or a repeated add_watched_repo MCP call, returns the
  // existing row instead of creating a duplicate to watch twice.
  async addWatchedRepo(
    userId: string,
    tier: 'free' | 'pro',
    owner: string,
    name: string,
    labelFilter?: string[],
  ) {
    const [existing] = await this.db
      .select()
      .from(watchedRepos)
      .where(
        and(
          eq(watchedRepos.userId, userId),
          eq(watchedRepos.owner, owner),
          eq(watchedRepos.name, name),
        ),
      );
    if (existing) {
      return existing;
    }

    if (tier === 'free') {
      const [{ value }] = await this.db
        .select({ value: count() })
        .from(watchedRepos)
        .where(eq(watchedRepos.userId, userId));
      if (value >= FREE_TIER_WATCHED_REPO_LIMIT) {
        throw new FreeTierLimitExceededException();
      }
    }

    const [repo] = await this.db
      .insert(watchedRepos)
      .values({
        id: randomUUID(),
        userId,
        owner,
        name,
        labelFilter: labelFilter?.length ? labelFilter : DEFAULT_LABEL_FILTER,
      })
      .returning();
    return repo;
  }

  async removeWatchedRepo(id: string, userId: string): Promise<void> {
    const deleted = await this.db
      .delete(watchedRepos)
      .where(and(eq(watchedRepos.id, id), eq(watchedRepos.userId, userId)))
      .returning({ id: watchedRepos.id });
    if (deleted.length === 0) {
      throw new NotFoundException(`no watched repo with id "${id}"`);
    }
  }
}
