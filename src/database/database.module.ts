import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE_CONNECTION');
const PG_POOL = Symbol('PG_POOL');

export type DrizzleDb = NodePgDatabase<typeof schema>;

// Migrations are never applied on boot - a separate, explicit step
// (`npm run db:migrate`, or the same command in a deploy pipeline).
// Concurrent app instances racing to auto-migrate the same live database
// on every boot is exactly the footgun that separation avoids.
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        if (!process.env.DATABASE_URL) {
          throw new Error('DATABASE_URL is required (see .env.example).');
        }
        return new Pool({
          connectionString: process.env.DATABASE_URL,
          // Managed Postgres (Render, Neon, Supabase, ...) requires SSL,
          // with a cert chain from a private/internal CA that isn't in
          // Node's default trust store - rejectUnauthorized:false is the
          // standard, documented way to connect to these without pinning
          // a specific CA cert. Local Docker Postgres has no SSL at all,
          // so this only kicks in for a real deployment.
          ssl:
            process.env.NODE_ENV === 'production'
              ? { rejectUnauthorized: false }
              : undefined,
        });
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DrizzleDb => drizzle(pool, { schema }),
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
