export type SentimentLabel =
  'encouraged' | 'neutral' | 'discouraged' | 'stale_or_duplicate';

export interface MaintainerComment {
  body: string;
  createdAt: string;
}

export interface SentimentClassificationInput {
  issueTitle: string;
  maintainerComments: MaintainerComment[];
}

export interface SentimentResult {
  label: SentimentLabel;
  rationale: string;
}

/**
 * Abstraction over an LLM sentiment classifier - same swappable-provider
 * shape as EmbeddingProvider/GithubClient. Gemini is the only
 * implementation for now, but scoring never talks to a specific LLM API
 * directly, only to this interface.
 */
export interface SentimentProvider {
  readonly name: string;
  classify(input: SentimentClassificationInput): Promise<SentimentResult>;
}
