import type { GithubIssue } from '../github/github-client.interface';
import type { SentimentResult } from '../sentiment/sentiment-provider.interface';
import { ScoringService } from './scoring.service';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function baseIssue(overrides: Partial<GithubIssue> = {}): GithubIssue {
  return {
    number: 1,
    title: 'Some issue',
    url: 'https://github.com/o/r/issues/1',
    state: 'OPEN',
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
    labels: [],
    assigneeLogins: [],
    comments: [],
    crossReferencingPullRequests: [],
    maintainerCommentsFullyChecked: true,
    ...overrides,
  };
}

function reasonCodes(reasons: { code: string }[]): string[] {
  return reasons.map((r) => r.code);
}

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(() => {
    service = new ScoringService();
  });

  describe('real-issue regression fixtures', () => {
    // argo-cd #20801: two abandoned (closed, unmerged) PRs attempting a
    // fix, an unanswered design question from the maintainer, and the
    // issue has gone quiet for months - should land clearly in "low
    // score" territory, not just marginally below 100.
    it('scores argo-cd #20801 (abandoned attempts + unresolved design question) low', () => {
      const issue = baseIssue({
        updatedAt: daysAgo(200),
        crossReferencingPullRequests: [
          {
            number: 101,
            url: 'https://github.com/o/r/pull/101',
            state: 'CLOSED',
            isDraft: false,
            merged: false,
          },
          {
            number: 102,
            url: 'https://github.com/o/r/pull/102',
            state: 'CLOSED',
            isDraft: false,
            merged: false,
          },
        ],
      });
      const sentiment: SentimentResult = {
        label: 'discouraged',
        rationale:
          'Maintainer asked design questions that were never answered.',
      };

      const result = service.score({ issue, sentiment });

      expect(result.score).toBeLessThanOrEqual(30);
      expect(reasonCodes(result.reasons)).toEqual(
        expect.arrayContaining([
          'ABANDONED_ATTEMPTS',
          'SENTIMENT_DISCOURAGED',
          'STALE_ISSUE',
        ]),
      );
      expect(result.abandonedPrCount).toBe(2);
      expect(result.openCompetingPrCount).toBe(0);
    });

    // fluxcd/source-controller #666: a clean, recently-updated docs issue
    // with no assignee, no competing PRs, and no negative maintainer
    // signal - should score high.
    it('scores fluxcd/source-controller #666 (clean docs issue) high', () => {
      const issue = baseIssue({
        updatedAt: daysAgo(5),
        labels: ['documentation'],
      });
      const sentiment: SentimentResult = {
        label: 'neutral',
        rationale: 'No maintainer comments beyond triage.',
      };

      const result = service.score({ issue, sentiment });

      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.hasAssignee).toBe(false);
      expect(result.openCompetingPrCount).toBe(0);
      expect(result.abandonedPrCount).toBe(0);
    });

    // jenkinsci/jenkins #21801: a maintainer explicitly discouraged
    // working on this ("risky area, best left untouched") - the
    // sentiment penalty alone should be enough to tank an otherwise
    // clean-looking issue.
    it('scores jenkinsci/jenkins #21801 (explicit maintainer pushback) very low', () => {
      const issue = baseIssue({ updatedAt: daysAgo(15) });
      const sentiment: SentimentResult = {
        label: 'discouraged',
        rationale: 'Maintainer called this a risky area best left untouched.',
      };

      const result = service.score({ issue, sentiment });

      expect(result.score).toBeLessThanOrEqual(60);
      const sentimentReason = result.reasons.find(
        (r) => r.code === 'SENTIMENT_DISCOURAGED',
      );
      expect(sentimentReason?.severity).toBe('negative');
    });
  });

  describe('individual signals', () => {
    it('gives a clean, unassigned, fresh issue with no signals a perfect score', () => {
      const result = service.score({ issue: baseIssue(), sentiment: null });

      expect(result.score).toBe(100);
      expect(reasonCodes(result.reasons)).toEqual(['SENTIMENT_UNAVAILABLE']);
    });

    it('penalizes an active assignee harder than a stale one', () => {
      const active = service.score({
        issue: baseIssue({
          assigneeLogins: ['someone'],
          updatedAt: daysAgo(5),
        }),
        sentiment: null,
      });
      const stale = service.score({
        issue: baseIssue({
          assigneeLogins: ['someone'],
          updatedAt: daysAgo(60),
        }),
        sentiment: null,
      });

      expect(reasonCodes(active.reasons)).toContain('ASSIGNEE_ACTIVE');
      expect(reasonCodes(stale.reasons)).toContain('ASSIGNEE_STALE');
      expect(active.score).toBeLessThan(stale.score);
      expect(active.hasAssignee).toBe(true);
    });

    it('caps the open-competing-PR penalty instead of scaling unbounded', () => {
      const manyOpenPrs = Array.from({ length: 10 }, (_, i) => ({
        number: i,
        url: `https://github.com/o/r/pull/${i}`,
        state: 'OPEN' as const,
        isDraft: false,
        merged: false,
      }));

      const result = service.score({
        issue: baseIssue({ crossReferencingPullRequests: manyOpenPrs }),
        sentiment: null,
      });

      const reason = result.reasons.find(
        (r) => r.code === 'OPEN_COMPETING_PRS',
      );
      expect(reason?.params?.delta).toBe(-55); // openCompetingPrCap
      expect(result.openCompetingPrCount).toBe(10);
    });

    it('treats a merged referencing PR as a near-total "already resolved" signal', () => {
      const result = service.score({
        issue: baseIssue({
          crossReferencingPullRequests: [
            {
              number: 5,
              url: 'https://github.com/o/r/pull/5',
              state: 'MERGED',
              isDraft: false,
              merged: true,
            },
          ],
        }),
        sentiment: null,
      });

      expect(reasonCodes(result.reasons)).toContain('RESOLVED_BY_MERGED_PR');
      expect(result.score).toBeLessThanOrEqual(30);
    });

    it('applies a blocking-label penalty case-insensitively', () => {
      const result = service.score({
        issue: baseIssue({ labels: ['Wontfix'] }),
        sentiment: null,
      });

      expect(reasonCodes(result.reasons)).toContain('BLOCKING_LABEL');
    });

    it('never lets the score go below 0 even with every penalty stacked', () => {
      const result = service.score({
        issue: baseIssue({
          assigneeLogins: ['someone'],
          updatedAt: daysAgo(400),
          labels: ['wontfix'],
          crossReferencingPullRequests: [
            {
              number: 1,
              url: 'x',
              state: 'OPEN',
              isDraft: false,
              merged: false,
            },
            {
              number: 2,
              url: 'x',
              state: 'CLOSED',
              isDraft: false,
              merged: false,
            },
          ],
        }),
        sentiment: {
          label: 'stale_or_duplicate',
          rationale: 'Already fixed elsewhere.',
        },
      });

      expect(result.score).toBe(0);
    });

    it('orders reasons by absolute score impact, largest first', () => {
      const result = service.score({
        issue: baseIssue({ updatedAt: daysAgo(200), labels: ['wontfix'] }),
        sentiment: { label: 'neutral', rationale: 'x' },
      });

      const deltas = result.reasons.map((r) =>
        Math.abs(Number(r.params?.delta ?? 0)),
      );
      const sorted = [...deltas].sort((a, b) => b - a);
      expect(deltas).toEqual(sorted);
    });
  });
});
