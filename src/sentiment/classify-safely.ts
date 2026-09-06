import { Logger } from '@nestjs/common';
import type {
  SentimentClassificationInput,
  SentimentProvider,
  SentimentResult,
} from './sentiment-provider.interface';

const logger = new Logger('SentimentProvider');

// Sentiment is an enrichment on top of the deterministic score, never a
// requirement - a missing/misconfigured API key, a network blip, or an
// LLM returning something outside the 4-label schema must never block
// scoring (scoring.service degrades to a SENTIMENT_UNAVAILABLE reason
// instead). Also returns null up front when there's nothing to classify,
// so "no maintainer ever commented" isn't reported as a classifier
// failure.
export async function classifySafely(
  provider: SentimentProvider,
  input: SentimentClassificationInput,
): Promise<SentimentResult | null> {
  if (input.maintainerComments.length === 0) {
    return null;
  }
  try {
    return await provider.classify(input);
  } catch (error) {
    logger.warn(
      `sentiment classification via "${provider.name}" failed, scoring without it: ${String(error)}`,
    );
    return null;
  }
}
