import type { ClaimGateSnapshot } from '../database/schema';

// Below this, the deterministic score itself is already saying "this
// isn't a strong opportunity" (see scoring/weights.ts's base of 100) -
// no point spending an LLM call deciding whether to claim something the
// scorer already flagged as weak.
export const MIN_CLAIM_SCORE = 50;

export type GateInput = ClaimGateSnapshot;

// Pure, no DB/network access - the "rules before the LLM" half of the
// pattern. Returns every reason it rejected (not just the first), since
// the caller persists the full list for the audit trail. An empty array
// means the candidate is eligible for the LLM to decide on next; it does
// NOT mean "claim it", just "worth asking".
export function evaluateGate(input: GateInput): string[] {
  const reasons: string[] = [];

  if (input.hasAssignee) {
    reasons.push('ALREADY_ASSIGNED');
  }
  if (input.openCompetingPrCount > 0) {
    reasons.push('COMPETING_PR_OPEN');
  }
  if (
    input.sentimentLabel === 'discouraged' ||
    input.sentimentLabel === 'stale_or_duplicate'
  ) {
    reasons.push('MAINTAINER_DISCOURAGED');
  }
  if (input.score < MIN_CLAIM_SCORE) {
    reasons.push('SCORE_TOO_LOW');
  }

  return reasons;
}
