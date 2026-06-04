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
    outboxSent: 0,
    outboxRetried: 0,
    outboxDeadLettered: 0,
    outboxExpired: 0,
    outboxDrains: 0,
    outboxQueueDepth: 0,
    outboxDeliveryMsTotal: 0,
    outboxOldestJobAgeSeconds: 0,
    outboxLockAcquireFailures: 0,
    outboxRecoveryDuplicates: 0,
    outboxRecoveryFetches: 0,
    outboxRecoveryFailures: 0,
    outboxRecoveryMarkerMissing: 0,
    outboxMarkSentFailures: 0,
    outboxRecoveryVerifyEnabledGuilds: 0,
    outboxLastDrainAt: 0,
    startedAt: Date.now()
  };
}

export { createMetrics };
