import { Global, Module } from '@nestjs/common';
import { GeminiSentimentProvider } from './providers/gemini-sentiment.provider';

export const SENTIMENT_PROVIDER = Symbol('SENTIMENT_PROVIDER');

// Global, same as GithubModule/DatabaseModule - refresh and MCP's
// check_issue_feasibility both need this, and it has no per-module
// configuration to justify importing it explicitly everywhere.
@Global()
@Module({
  providers: [
    { provide: SENTIMENT_PROVIDER, useClass: GeminiSentimentProvider },
  ],
  exports: [SENTIMENT_PROVIDER],
})
export class SentimentModule {}
