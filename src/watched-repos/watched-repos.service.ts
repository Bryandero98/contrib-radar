import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import { watchedRepos } from '../database/schema';

const DEFAULT_LABEL_FILTER = ['good first issue'];

@Injectable()
export class WatchedReposService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listWatchedRepos() {
    return this.db.select().from(watchedRepos);
  }

  async getWatchedRepo(id: string) {
    const [repo] = await this.db
      .select()
      .from(watchedRepos)
      .where(eq(watchedRepos.id, id));
    if (!repo) {
      throw new NotFoundException(`no watched repo with id "${id}"`);
    }
    return repo;
  }

  // Idempotent by (owner, name): a double-click on "add repo" in the
  // dashboard, or a repeated add_watched_repo MCP call, returns the
  // existing row instead of creating a duplicate to watch twice.
  async addWatchedRepo(owner: string, name: string, labelFilter?: string[]) {
    const [existing] = await this.db
      .select()
      .from(watchedRepos)
      .where(and(eq(watchedRepos.owner, owner), eq(watchedRepos.name, name)));
    if (existing) {
      return existing;
    }

    const [repo] = await this.db
      .insert(watchedRepos)
      .values({
        id: randomUUID(),
        owner,
        name,
        labelFilter: labelFilter?.length ? labelFilter : DEFAULT_LABEL_FILTER,
      })
      .returning();
    return repo;
  }

  async removeWatchedRepo(id: string): Promise<void> {
    const deleted = await this.db
      .delete(watchedRepos)
      .where(eq(watchedRepos.id, id))
      .returning({ id: watchedRepos.id });
    if (deleted.length === 0) {
      throw new NotFoundException(`no watched repo with id "${id}"`);
    }
  }
}
