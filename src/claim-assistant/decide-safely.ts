import { Logger } from '@nestjs/common';
import type {
  ClaimCandidate,
  ClaimDecisionProvider,
  ClaimDecisionResult,
} from './claim-decision-provider.interface';

const logger = new Logger('ClaimDecisionProvider');

// Mirrors classify-safely.ts: any exception or malformed provider output
// degrades to an abstention, never a thrown error - a broken/misconfigured
// LLM must never block the review queue, and "abstained, reason
// LLM_UNAVAILABLE" is itself a meaningful, auditable outcome.
export async function decideSafely(
  provider: ClaimDecisionProvider,
  candidate: ClaimCandidate,
): Promise<ClaimDecisionResult> {
  try {
    return await provider.decide(candidate);
  } catch (error) {
    logger.warn(
      `claim decision via "${provider.name}" failed, abstaining: ${String(error)}`,
    );
    return { decision: 'abstain', reason: 'LLM_UNAVAILABLE' };
  }
}
