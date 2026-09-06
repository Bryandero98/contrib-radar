import type { GithubIssue } from '../../github/github-client.interface';
import { daysSince } from '../date-utils';
import { WEIGHTS } from '../weights';
import type { SignalResult } from './signal-result.interface';

export function assessStalenessSignal(issue: GithubIssue): SignalResult {
  const days = daysSince(issue.updatedAt);
  const tier = WEIGHTS.stalenessTiers.find((t) => days <= t.days);
  // stalenessTiers' last entry caps at Infinity, so this is unreachable -
  // the fallback only exists to satisfy the type checker.
  const penalty = tier?.penalty ?? 0;

  if (penalty === 0) {
    return { penalty: 0, reasons: [] };
  }

  return {
    penalty,
    reasons: [
      {
        code: 'STALE_ISSUE',
        severity: 'info',
        params: { delta: -penalty, daysSinceUpdate: Math.round(days) },
      },
    ],
  };
}
