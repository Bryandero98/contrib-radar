import { Injectable } from '@nestjs/common';
import type { ScoreReason } from '../database/schema';
import type { GithubIssue } from '../github/github-client.interface';
import type { SentimentResult } from '../sentiment/sentiment-provider.interface';
import { assessAssigneeSignal } from './signals/assignee.signal';
import { assessBlockingLabelsSignal } from './signals/blocking-labels.signal';
import {
  assessCompetingPrsSignal,
  countCompetingPrs,
} from './signals/competing-prs.signal';
import { assessStalenessSignal } from './signals/staleness.signal';
import { WEIGHTS } from './weights';

export interface ScoringInput {
  issue: GithubIssue;
  sentiment: SentimentResult | null;
}

export interface ScoringResult {
  score: number;
  reasons: ScoreReason[];
  hasAssignee: boolean;
  openCompetingPrCount: number;
  abandonedPrCount: number;
}

// Pure functions only - no DB, no network, no injected dependency beyond
// what's passed in. Takes data already fetched by GraphQL plus an already-
// classified sentiment result (or null), returns { score, reasons }. This
// is the one module in the project where "sin errores" applies most
// literally, so it stays the most trivially testable piece of the whole
// codebase (see scoring.service.spec.ts's 3 real-issue fixtures).
@Injectable()
export class ScoringService {
  score({ issue, sentiment }: ScoringInput): ScoringResult {
    const signalResults = [
      assessAssigneeSignal(issue),
      assessCompetingPrsSignal(issue),
      assessStalenessSignal(issue),
      assessBlockingLabelsSignal(issue),
    ];

    const penalty = signalResults.reduce((sum, s) => sum + s.penalty, 0);
    const reasons: ScoreReason[] = signalResults.flatMap((s) => s.reasons);

    const sentimentDelta = sentiment
      ? WEIGHTS.sentimentDelta[sentiment.label]
      : 0;
    reasons.push(this.buildSentimentReason(sentiment, sentimentDelta));

    // Biggest-impact reason first - the dashboard shows these in order,
    // and whatever moved the score the most is what the reader needs to
    // see first, not whatever signal happened to run first.
    reasons.sort(
      (a, b) => Math.abs(this.deltaOf(b)) - Math.abs(this.deltaOf(a)),
    );

    const rawScore = WEIGHTS.base - penalty + sentimentDelta;
    const score = Math.min(100, Math.max(0, rawScore));
    const competing = countCompetingPrs(issue);

    return {
      score,
      reasons,
      hasAssignee: issue.assigneeLogins.length > 0,
      openCompetingPrCount: competing.open,
      abandonedPrCount: competing.abandoned,
    };
  }

  private buildSentimentReason(
    sentiment: SentimentResult | null,
    delta: number,
  ): ScoreReason {
    if (!sentiment) {
      return {
        code: 'SENTIMENT_UNAVAILABLE',
        severity: 'info',
        params: { delta: 0 },
      };
    }
    return {
      code: `SENTIMENT_${sentiment.label.toUpperCase()}`,
      severity: delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'info',
      params: { delta, rationale: sentiment.rationale },
    };
  }

  private deltaOf(reason: ScoreReason): number {
    const delta = reason.params?.delta;
    return typeof delta === 'number' ? delta : 0;
  }
}
