/**
 * The candidate the LLM decides on - only issues that already passed the
 * deterministic gate (see claim-gate.ts) ever reach this interface. The
 * LLM can still abstain even on a passing candidate; this is the second
 * of the pattern's two abstention layers.
 */
export interface ClaimCandidate {
  issueTitle: string;
  issueBody: string;
  repoOwner: string;
  repoName: string;
}

export type ClaimDecisionResult =
  | { decision: 'claim'; comment: string }
  | { decision: 'abstain'; reason: string };

/**
 * Abstraction over an LLM claim-decision classifier - same swappable-
 * provider shape as SentimentProvider/GithubClient. Gemini is the only
 * implementation for now, but ClaimAssistantService never talks to a
 * specific LLM API directly, only to this interface.
 */
export interface ClaimDecisionProvider {
  readonly name: string;
  decide(candidate: ClaimCandidate): Promise<ClaimDecisionResult>;
}
