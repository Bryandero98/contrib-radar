// A minimal spacing-based limiter: schedule() never lets calls start closer
// together than intervalMs apart, so a burst gets serialized instead of
// firing all at once and tripping a provider's per-minute quota. One
// instance is meant to be shared across every call from the same provider
// (the quota is per API key/token, not per request) - both the GitHub
// GraphQL provider and the Gemini sentiment provider use their own
// instance of this same class.
export class RateLimiter {
  private nextSlot = 0;

  constructor(private readonly intervalMs: number) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.intervalMs;
    const wait = slot - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    return fn();
  }
}
