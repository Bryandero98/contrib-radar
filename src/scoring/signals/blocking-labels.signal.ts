import type { GithubIssue } from '../../github/github-client.interface';
import { BLOCKING_LABELS, WEIGHTS } from '../weights';
import type { SignalResult } from './signal-result.interface';

export function assessBlockingLabelsSignal(issue: GithubIssue): SignalResult {
  const matched = issue.labels.filter((label) =>
    BLOCKING_LABELS.has(label.toLowerCase()),
  );

  if (matched.length === 0) {
    return { penalty: 0, reasons: [] };
  }

  return {
    penalty: WEIGHTS.blockingLabelPenalty,
    reasons: [
      {
        code: 'BLOCKING_LABEL',
        severity: 'negative',
        params: { delta: -WEIGHTS.blockingLabelPenalty, labels: matched },
      },
    ],
  };
}
