import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';
import { issueScores } from '../database/schema';

export type IssueSort = 'score' | 'updated';

@Injectable()
export class IssuesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // Default order is score descending - highest-opportunity issue first,
  // matching the whole point of the project. The dashboard's own column
  // sort handles every other ordering client-side against the same
  // already-fetched rows.
  async listScoredIssues(watchedRepoId: string, sort: IssueSort = 'score') {
    const orderColumn =
      sort === 'updated' ? issueScores.githubUpdatedAt : issueScores.score;
    return this.db
      .select()
      .from(issueScores)
      .where(eq(issueScores.watchedRepoId, watchedRepoId))
      .orderBy(desc(orderColumn));
  }
}
