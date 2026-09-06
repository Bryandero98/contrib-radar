import type { GithubIssue } from '../../github/github-client.interface';
import { daysSince } from '../date-utils';
import { STALE_ASSIGNEE_DAYS, WEIGHTS } from '../weights';
import type { SignalResult } from './signal-result.interface';

// An assignee is a strong "don't duplicate work" signal, but a claim that
// has sat untouched for a while is more often abandoned than active - it
// should surface as a real but softer warning, not the same hard block as
// a fresh claim (a lesson from today's manual research, where several
// "assigned" issues turned out to be long-dead claims).
export function assessAssigneeSignal(issue: GithubIssue): SignalResult {
  if (issue.assigneeLogins.length === 0) {
    return { penalty: 0, reasons: [] };
  }

  const daysSinceUpdate = daysSince(issue.updatedAt);
  const isStale = daysSinceUpdate > STALE_ASSIGNEE_DAYS;
  const penalty = isStale
    ? WEIGHTS.assigneeStalePenalty
    : WEIGHTS.assigneeActivePenalty;

  return {
    penalty,
    reasons: [
      {
        code: isStale ? 'ASSIGNEE_STALE' : 'ASSIGNEE_ACTIVE',
        severity: 'warning',
        params: {
          delta: -penalty,
          assignees: issue.assigneeLogins,
          daysSinceUpdate: Math.round(daysSinceUpdate),
        },
      },
    ],
  };
}
