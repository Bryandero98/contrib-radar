import type { GithubIssue } from '../../github/github-client.interface';
import { WEIGHTS } from '../weights';
import type { SignalResult } from './signal-result.interface';

export interface CompetingPrCounts {
  open: number;
  abandoned: number;
  resolvedByMergedPr: boolean;
}

// Shared with scoring.service, which persists open/abandoned counts onto
// issue_scores regardless of whether they moved the score this refresh.
export function countCompetingPrs(issue: GithubIssue): CompetingPrCounts {
  let open = 0;
  let abandoned = 0;
  let resolvedByMergedPr = false;

  for (const pr of issue.crossReferencingPullRequests) {
    if (pr.merged) {
      resolvedByMergedPr = true;
    } else if (pr.state === 'OPEN') {
      open++;
    } else if (pr.state === 'CLOSED') {
      abandoned++;
    }
  }

  return { open, abandoned, resolvedByMergedPr };
}

export function assessCompetingPrsSignal(issue: GithubIssue): SignalResult {
  const counts = countCompetingPrs(issue);
  const reasons: SignalResult['reasons'] = [];
  let penalty = 0;

  // A merged PR referencing this issue almost certainly means it's already
  // resolved - this is the strongest possible "don't work on this" signal,
  // independent of everything else about the issue.
  if (counts.resolvedByMergedPr) {
    penalty += WEIGHTS.mergedPrResolvedPenalty;
    reasons.push({
      code: 'RESOLVED_BY_MERGED_PR',
      severity: 'negative',
      params: { delta: -WEIGHTS.mergedPrResolvedPenalty },
    });
  }

  if (counts.open > 0) {
    const openPenalty = Math.min(
      counts.open * WEIGHTS.openCompetingPrPenalty,
      WEIGHTS.openCompetingPrCap,
    );
    penalty += openPenalty;
    reasons.push({
      code: 'OPEN_COMPETING_PRS',
      severity: 'warning',
      params: { delta: -openPenalty, count: counts.open },
    });
  }

  if (counts.abandoned > 0) {
    const abandonedPenalty = Math.min(
      counts.abandoned * WEIGHTS.abandonedAttemptPenalty,
      WEIGHTS.abandonedAttemptCap,
    );
    penalty += abandonedPenalty;
    reasons.push({
      code: 'ABANDONED_ATTEMPTS',
      severity: 'warning',
      params: { delta: -abandonedPenalty, count: counts.abandoned },
    });
  }

  return { penalty, reasons };
}
