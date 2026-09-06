// Named constants only - no magic numbers inline in the signal files. Every
// penalty here is a deliberate design decision, not a tuned-to-fit value:
// see scoring.service.spec.ts's 3 real-issue fixtures for what each one is
// meant to produce.

// A refresh younger than this returns the cached issue_scores snapshot
// instead of hitting GitHub/Gemini again - stops a double-click on the
// dashboard's Refresh button (or a repeated MCP call) from burning API
// budget for no new information.
export const REFRESH_COOLDOWN_MINUTES = 5;

export const WEIGHTS = {
  base: 100,

  assigneeActivePenalty: 60,
  assigneeStalePenalty: 15,

  openCompetingPrPenalty: 35,
  openCompetingPrCap: 55,
  mergedPrResolvedPenalty: 70,
  abandonedAttemptPenalty: 15,
  abandonedAttemptCap: 45,

  stalenessTiers: [
    { days: 30, penalty: 0 },
    { days: 90, penalty: 10 },
    { days: 180, penalty: 20 },
    { days: Infinity, penalty: 30 },
  ],

  blockingLabelPenalty: 50,

  sentimentDelta: {
    encouraged: 10,
    neutral: 0,
    discouraged: -40,
    stale_or_duplicate: -50,
  },
} as const;

// Labels that signal a maintainer has already closed the door on the issue
// being a free pick right now, independent of anything else about it.
// Matched case-insensitively against the raw GitHub label name.
export const BLOCKING_LABELS: ReadonlySet<string> = new Set([
  'blocked',
  'wontfix',
  'duplicate',
  'invalid',
]);

// An assignee attempt is only "stale" (soft signal - probably abandoned)
// once the issue has gone this long without any update; before that, an
// active-looking claim still blocks a new contributor from a clean start.
export const STALE_ASSIGNEE_DAYS = 30;
