import type { BotMetrics } from "../../types";

function createMetrics(): BotMetrics {
  return {
    fetchSuccess: 0,
    fetchFail: 0,
    httpRetries: 0,
    rateLimitHits: 0,
    cronRuns: 0,
    cronErrors: 0,
    cronSkippedDueToLock: 0,
    cronSkippedDueToHealth: 0,
    cronAborted: 0,
    httpRateLimitDrops: 0,
    startedAt: Date.now(),
    sourceFetchSuccess: {},
    sourceFailures: {},
    schemaDriftBySource: {}
  };
}

export { createMetrics };
