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
 * A registered account - created/updated on every GitHub OAuth login
 * (`findOrCreateByGithub`, upserted by `githubId`, so a GitHub username
 * change doesn't orphan the account). `apiKeyHash` is a sha256 digest of
 * the raw key shown to the user exactly once when generated - the raw key
 * itself is never persisted. `tier` gates the free-tier watched-repo cap
 * (see WatchedReposService.addWatchedRepo); `stripeCustomerId`/
 * `stripeSubscriptionId` are set once the billing webhook sees a
 * completed checkout, used to map a later webhook event back to a user.
 */
export const userTierEnum = pgEnum('user_tier', ['free', 'pro']);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    githubId: text('github_id').notNull(),
    githubLogin: text('github_login').notNull(),
    avatarUrl: text('avatar_url'),
    tier: userTierEnum('tier').notNull().default('free'),
    apiKeyHash: text('api_key_hash'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    // A Slack incoming-webhook URL, restricted to hooks.slack.com in the
    // DTO/service layer (see users.service.ts) - the server POSTs to
    // whatever URL is stored here on every new issue found, so accepting
    // an arbitrary user-supplied URL would be a textbook SSRF vector
    // (internal services, cloud metadata endpoints, etc).
    alertWebhookUrl: text('alert_webhook_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('users_github_id_idx').on(table.githubId),
    // Postgres unique indexes ignore NULLs, so any number of users who
    // haven't generated a key yet (apiKeyHash === null) coexist fine.
    uniqueIndex('users_api_key_hash_idx').on(table.apiKeyHash),
    index('users_stripe_customer_id_idx').on(table.stripeCustomerId),
  ],
);

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
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    index('watched_repos_user_id_idx').on(table.userId),
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
    // The raw issue description - scoring itself never reads this, only
    // claim-assistant does (drafting a claim comment needs more than the
    // title). Stored here instead of fetched fresh at draft time so
    // draftClaim never needs its own GitHub round-trip.
    body: text('body').notNull().default(''),
    url: text('url').notNull(),
    state: text('state').notNull(),
    githubUpdatedAt: timestamp('github_updated_at', {
      withTimezone: true,
    }).notNull(),
    hasAssignee: boolean('has_assignee').notNull().default(false),
    openCompetingPrCount: integer('open_competing_pr_count')
      .notNull()
      .default(0),
    // Draft PRs referencing the issue - tracked separately from
    // openCompetingPrCount because a draft is a materially weaker "someone's
    // already on this" signal than a ready-for-review PR (see
    // scoring/signals/competing-prs.signal.ts).
    openDraftPrCount: integer('open_draft_pr_count').notNull().default(0),
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

export const claimDraftStatusEnum = pgEnum('claim_draft_status', [
  'abstained',
  'pending_review',
  'approved',
  'posted',
  'rejected',
]);

/**
 * A snapshot of the deterministic signals the gate saw when it decided -
 * without this, an empty `gateReasons` ("passed cleanly") tells you
 * nothing auditable about *why* it passed. Mirrors the subset of
 * issue_scores fields the gate actually reads (see claim-gate.ts).
 */
export interface ClaimGateSnapshot {
  hasAssignee: boolean;
  openCompetingPrCount: number;
  sentimentLabel: string | null;
  score: number;
}

/**
 * One attempt at "should I claim this issue" - created by draftClaim,
 * terminated by approve/reject (see claim-assistant.service.ts). Treated
 * as append-only by application convention (no code path updates a row
 * once it reaches a terminal status), not by a DB constraint - a single
 * user's audit trail doesn't need more than that discipline in v1.
 */
export const claimDrafts = pgTable(
  'claim_drafts',
  {
    id: text('id').primaryKey(),
    watchedRepoId: text('watched_repo_id')
      .notNull()
      .references(() => watchedRepos.id, { onDelete: 'cascade' }),
    issueNumber: integer('issue_number').notNull(),
    status: claimDraftStatusEnum('status').notNull(),
    gateReasons: jsonb('gate_reasons').$type<string[]>().notNull(),
    gateSnapshot: jsonb('gate_snapshot').$type<ClaimGateSnapshot>().notNull(),
    // Set only when the LLM (not the gate) chose to abstain on an issue
    // that otherwise passed.
    llmAbstainReason: text('llm_abstain_reason'),
    // Null until a draft is actually written (gate-abstained rows never get one).
    draftComment: text('draft_comment'),
    // Set only once, when status becomes 'posted' - never rewritten after.
    postedCommentUrl: text('posted_comment_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    index('claim_drafts_watched_repo_idx').on(table.watchedRepoId),
    // One draft per issue - a double-click or a concurrent request must
    // not create two, since the dashboard shows one "Draft claim" button
    // per issue that doesn't have one yet.
    uniqueIndex('claim_drafts_repo_issue_idx').on(
      table.watchedRepoId,
      table.issueNumber,
    ),
  ],
);
