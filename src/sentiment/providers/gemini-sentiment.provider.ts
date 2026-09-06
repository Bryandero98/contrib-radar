import { Injectable } from '@nestjs/common';
import { RateLimiter } from '../../common/rate-limiter';
import type {
  SentimentClassificationInput,
  SentimentLabel,
  SentimentProvider,
  SentimentResult,
} from '../sentiment-provider.interface';

// gemini-2.5-flash was retired for new API keys (confirmed live against
// this project's key: a 404 pointing at gemini-3.6-flash as the
// replacement) - see Fase 5's manual verification report.
const GEMINI_GENERATE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

// Same conservative spacing as GeminiEmbeddingProvider - free-tier quota is
// shared per API key across every Gemini call this process makes.
const RPM_LIMIT = 12;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
// A maintainer thread can run long; truncate defensively so one issue
// can't blow up the prompt (and the token bill) far past what the
// classification actually needs.
const MAX_COMMENTS_IN_PROMPT = 15;
const MAX_COMMENT_CHARS = 2000;

const SENTIMENT_LABELS: ReadonlySet<SentimentLabel> = new Set([
  'encouraged',
  'neutral',
  'discouraged',
  'stale_or_duplicate',
]);

// Gemini's structured-output schema uses uppercase OpenAPI-subset type
// names (STRING/OBJECT/...), not JSON Schema's lowercase ones.
const SENTIMENT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label: {
      type: 'STRING',
      enum: ['encouraged', 'neutral', 'discouraged', 'stale_or_duplicate'],
    },
    rationale: { type: 'STRING' },
  },
  required: ['label', 'rationale'],
};

interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

interface RawSentimentPayload {
  label: string;
  rationale: string;
}

// Reference SentimentProvider implementation for Gemini. Structured output
// (responseSchema) makes the shape reliable, but a schema-valid response
// can still be a label the model invented under pressure - this is the
// bounded, deterministic-then-LLM design from the plan: the 4-label enum
// is re-validated here, not just trusted because the JSON parsed.
@Injectable()
export class GeminiSentimentProvider implements SentimentProvider {
  readonly name = 'gemini';
  private readonly rateLimiter = new RateLimiter(60_000 / RPM_LIMIT);

  async classify(
    input: SentimentClassificationInput,
  ): Promise<SentimentResult> {
    return this.rateLimiter.schedule(() => this.classifyWithRetry(input, 0));
  }

  private async classifyWithRetry(
    input: SentimentClassificationInput,
    attempt: number,
  ): Promise<SentimentResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is required to classify maintainer sentiment (see .env.example).',
      );
    }

    const prompt = this.buildPrompt(input);

    const response = await fetch(`${GEMINI_GENERATE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SENTIMENT_RESPONSE_SCHEMA,
        },
      }),
    });

    // 503 ("model overloaded") is exactly as transient as a 429 in
    // practice with Gemini - confirmed live during Fase 5's manual
    // verification, where a real call hit it - and retrying it the same
    // way costs nothing since classifySafely already treats a final
    // failure as a graceful no-op.
    if (
      (response.status === 429 || response.status === 503) &&
      attempt < MAX_RETRIES
    ) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.classifyWithRetry(input, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Gemini sentiment request failed (${response.status}): ${body}`,
      );
    }

    const payload: GeminiGenerateContentResponse =
      (await response.json()) as GeminiGenerateContentResponse;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini sentiment response had no candidate text');
    }

    const parsed: RawSentimentPayload = JSON.parse(text) as RawSentimentPayload;
    if (!SENTIMENT_LABELS.has(parsed.label as SentimentLabel)) {
      throw new Error(
        `Gemini returned an unrecognized sentiment label: "${parsed.label}"`,
      );
    }

    return {
      label: parsed.label as SentimentLabel,
      rationale: parsed.rationale,
    };
  }

  private buildPrompt(input: SentimentClassificationInput): string {
    const comments = input.maintainerComments
      .slice(-MAX_COMMENTS_IN_PROMPT)
      .map((c) => `- ${c.body.slice(0, MAX_COMMENT_CHARS)}`)
      .join('\n');

    return `You are triaging an open-source issue titled "${input.issueTitle}".

Below are comments from this repository's MAINTAINERS ONLY (owners,
members, or collaborators - never other contributors). Classify their
overall stance toward someone picking this issue up right now.

Maintainer comments:
${comments}

Labels:
- encouraged: a maintainer confirmed this is available and welcomed a contribution.
- neutral: no clear signal either way.
- discouraged: a maintainer raised concerns, pushed back on the approach, or asked to hold off.
- stale_or_duplicate: a maintainer said this is already fixed, superseded, or a duplicate.

Respond with the single best-fitting label and a one-sentence rationale grounded in the comments above.`;
  }
}
