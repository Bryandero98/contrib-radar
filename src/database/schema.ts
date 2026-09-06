import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * A single reasons entry the scoring engine attaches to a score - the
 * dashboard maps `severity` straight to an icon (positive=✓, info=ℹ,
 * warning=⚠, negative=✗) and never re-derives it from anything else, so
 * this shape has to travel with the score itself, not be reconstructed
 * client-side from a plain string.
 */
export interface ScoreReason {
  code: string;
  severity: 'positive' | 'info' | 'warning' | 'negative';
  params?: Record<string, unknown>;
}

/**
 * A repo (owner/name) the user wants scored issues for. `labelFilter` is
 * an array (not a single string) so a repo can watch more than one label
 * later without a migration - defaults to the one label everyone actually
 * means by "good first issue".
 */
export const watchedRepos = pgTable(
  'watched_repos',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    labelFilter: text('label_filter')
      .array()
      .notNull()
      .default(['good first issue']),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Read and written by refresh.service's cooldown check (see
    // REFRESH_COOLDOWN_MINUTES in scoring/weights.ts) - null until the
    // first successful refresh.
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  },
  (table) => [
    index('watched_repos_owner_name_idx').on(table.owner, table.name),
  ],
);

export const sentimentLabelEnum = pgEnum('sentiment_label', [
  'encouraged',
  'neutral',
  'discouraged',
  'stale_or_duplicate',
]);

/**
 * The current scored snapshot of one issue - overwritten (upsert) on every
 * refresh, not appended to. This is deliberate for the MVP (see the plan's
 * "preparado para historial" note): a future issue_score_history table
 * would key off the same (watched_repo_id, issue_number) pair as its own
 * foreign key, one row per refresh instead of an upsert - this table
 * doesn't need to change to support that later.
 */
export const issueScores = pgTable(
  'issue_scores',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    watchedRepoId: text('watched_repo_id')
      .notNull()
      .references(() => watchedRepos.id, { onDelete: 'cascade' }),
    issueNumber: integer('issue_number').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    state: text('state').notNull(),
    githubUpdatedAt: timestamp('github_updated_at', {
      withTimezone: true,
    }).notNull(),
    hasAssignee: boolean('has_assignee').notNull().default(false),
    openCompetingPrCount: integer('open_competing_pr_count')
      .notNull()
      .default(0),
    abandonedPrCount: integer('abandoned_pr_count').notNull().default(0),
    // Null means the sentiment classifier didn't run or failed - the score
    // still exists (classifySafely degrades to deterministic-only), it
    // just carries a SENTIMENT_UNAVAILABLE reason instead of a label.
    sentimentLabel: sentimentLabelEnum('sentiment_label'),
    sentimentRationale: text('sentiment_rationale'),
    score: integer('score').notNull(),
    reasons: jsonb('reasons').$type<ScoreReason[]>().notNull(),
    scoredAt: timestamp('scored_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('issue_scores_repo_issue_idx').on(
      table.watchedRepoId,
      table.issueNumber,
    ),
  ],
);
