import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../database/database.module';

export interface HealthResult {
  readonly status: 'ok' | 'error';
  readonly checks: {
    readonly database: 'ok' | 'error';
    /** GraphQL has no anonymous tier - without this, refresh/check_issue_feasibility fail outright, but watched-repos CRUD and reading an existing snapshot still work, so this stays informational rather than tanking overall status. */
    readonly githubToken: 'configured' | 'not-configured';
    /** Same lazy env-var check GeminiSentimentProvider does at call time - classifySafely degrades to deterministic-only scoring without one. */
    readonly sentimentProvider: 'configured' | 'not-configured';
  };
}

@Injectable()
export class HealthService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async check(): Promise<HealthResult> {
    const database = await this.checkDatabase();
    return {
      status: database === 'ok' ? 'ok' : 'error',
      checks: {
        database,
        githubToken: process.env.GITHUB_TOKEN ? 'configured' : 'not-configured',
        sentimentProvider: process.env.GEMINI_API_KEY
          ? 'configured'
          : 'not-configured',
      },
    };
  }

  private async checkDatabase(): Promise<'ok' | 'error'> {
    try {
      await this.db.execute(sql`select 1`);
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
