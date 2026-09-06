import type { ThrottlerOptions } from '@nestjs/throttler';

// Shared by every mutating endpoint (POST/DELETE on watched-repos, POST on
// refresh) - tighter than ThrottlerModule.forRoot's global default, since a
// write here can trigger a GitHub GraphQL + Gemini call chain, not just a
// cheap DB read.
export const WRITE_THROTTLE: Record<string, ThrottlerOptions> = {
  default: { ttl: 60000, limit: 20 },
};
