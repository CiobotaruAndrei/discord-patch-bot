import type { BotMetrics } from "./metricsTypes.js";
import type { MetricRecorders } from "../../shared/metricRecorderPorts.js";

type CounterField = {
  [K in keyof BotMetrics]-?: BotMetrics[K] extends number | undefined ? K : never;
}[keyof BotMetrics];

function bump(metrics: BotMetrics, field: CounterField, by = 1): void {
  const current = metrics[field];
  metrics[field] = (typeof current === "number" ? current : 0) + by;
}

function assign(metrics: BotMetrics, field: CounterField, value: number): void {
  metrics[field] = value;
}

export function createMetricRecorders(metrics: BotMetrics): MetricRecorders {
  return {
    security: {
      threatDeleted: () => bump(metrics, "securityThreatsDeleted"),
      threatDeleteFailed: () => bump(metrics, "securityThreatDeleteFailures"),
      botAddBlocked: () => bump(metrics, "securityBotAddsBlocked"),
      runtimeErrored: () => bump(metrics, "securityRuntimeErrors")
    },
    inspector: {
      sandboxApplied: active => assign(metrics, "nativeInspectorSandboxed", active ? 1 : 0),
      processKilled: () => bump(metrics, "nativeInspectorKills"),
      processRestarted: total => assign(metrics, "nativeInspectorRestarts", total),
      scanTimedOut: () => bump(metrics, "nativeInspectorTimeouts")
    },
    threatEngine: {
      scanned: at => {
        bump(metrics, "threatEngineScans");
        assign(metrics, "threatEngineLastScanAt", at);
      },
      knownVersions: () => ({
        engine: metrics.threatEngineVersion ?? "",
        database: metrics.threatEngineDatabaseVersion ?? ""
      }),
      versionsObserved: versions => {
        if (versions.engine !== "") metrics.threatEngineVersion = versions.engine;
        if (versions.database !== "") metrics.threatEngineDatabaseVersion = versions.database;
      },
      versionChanged: () => bump(metrics, "threatEngineVersionChanges"),
      probeFailed: reason => {
        const failures = metrics.threatEngineFailures ?? {};
        failures[reason] = (failures[reason] ?? 0) + 1;
        metrics.threatEngineFailures = failures;
      }
    },
    permissionDelegation: {
      reverted: (count = 1) => bump(metrics, "permissionDelegationsReverted", count)
    },
    http: {
      fetchSucceeded: () => bump(metrics, "fetchSuccess"),
      fetchFailed: () => bump(metrics, "fetchFail"),
      retried: () => bump(metrics, "httpRetries"),
      rateLimited: () => bump(metrics, "rateLimitHits")
    },
    redis: {
      connected: () => bump(metrics, "redisConnectSuccess"),
      connectFailed: () => bump(metrics, "redisConnectFailure"),
      cacheHit: () => bump(metrics, "redisCacheHit"),
      cacheMissed: () => bump(metrics, "redisCacheMiss"),
      errored: () => bump(metrics, "redisErrors")
    },
    cron: {
      ran: () => bump(metrics, "cronRuns"),
      errored: () => bump(metrics, "cronErrors"),
      skippedByLock: () => bump(metrics, "cronSkippedDueToLock"),
      skippedByHealth: () => bump(metrics, "cronSkippedDueToHealth"),
      aborted: () => bump(metrics, "cronAborted"),
      currentCycle: () => metrics.cronRuns ?? 0
    },
    outbox: {
      drained: (totals, at) => {
        bump(metrics, "outboxDrains");
        assign(metrics, "outboxLastDrainAt", at);
        for (const [field, value] of [
          ["outboxSent", totals.sent],
          ["outboxRetried", totals.retried],
          ["outboxDeadLettered", totals.deadLettered],
          ["outboxExpired", totals.expired],
          ["outboxDeliveryMsTotal", totals.deliveryMsTotal],
          ["outboxRecoveryDuplicates", totals.recoveryDuplicates],
          ["outboxRecoveryFetches", totals.recoveryFetches],
          ["outboxRecoveryFailures", totals.recoveryFailures],
          ["outboxRecoveryMarkerMissing", totals.recoveryMarkerMissing],
          ["outboxMarkSentFailures", totals.markSentFailures],
          ["outboxDeleteFailures", totals.deleteFailures],
          ["outboxDeadLetterWriteFailures", totals.deadLetterFailures],
          ["outboxHistoryWriteFailures", totals.historyWriteFailures]
        ] as ReadonlyArray<readonly [CounterField, number | undefined]>) {
          bump(metrics, field, value ?? 0);
        }
        if (typeof totals.queued === "number") assign(metrics, "outboxQueueDepth", totals.queued);
        if (typeof totals.oldestJobAgeMs === "number") assign(metrics, "outboxOldestJobAgeSeconds", Math.round(totals.oldestJobAgeMs / 1000));
        if (typeof totals.futureScheduledCount === "number") assign(metrics, "outboxFutureScheduledJobs", totals.futureScheduledCount);
        if (typeof totals.recoveryVerifyEnabledGuilds === "number") assign(metrics, "outboxRecoveryVerifyEnabledGuilds", totals.recoveryVerifyEnabledGuilds);
      },
      pauseCheckFailed: () => bump(metrics, "outboxPauseCheckFailures"),
      lockAcquireFailed: () => bump(metrics, "outboxLockAcquireFailures")
    },
    command: {
      ran: (command, durationMs) => {
        metrics.commandRuns[command] = (metrics.commandRuns[command] || 0) + 1;
        metrics.commandDurationMsTotal[command] = (metrics.commandDurationMsTotal[command] || 0) + durationMs;
      },
      errored: command => {
        metrics.commandErrors[command] = (metrics.commandErrors[command] || 0) + 1;
      }
    },
    channelLockRecovery: {
      ran: () => bump(metrics, "channelLockRecoveryRuns"),
      failed: () => bump(metrics, "channelLockRecoveryFailures"),
      converged: count => bump(metrics, "channelLockRecoveriesConverged", count)
    },
    moderationCleanup: {
      ran: () => bump(metrics, "moderationCleanupRuns"),
      failed: () => bump(metrics, "moderationCleanupFailures")
    },
    threatSurface: {
      reset: () => {
        assign(metrics, "yaraRulesLoaded", 0);
        assign(metrics, "yaraEngineAvailable", 0);
        assign(metrics, "threatReputationEngineConfigured", 0);
      },
      reputationConfigured: configured => assign(metrics, "threatReputationEngineConfigured", configured ? 1 : 0),
      yaraRulesetObserved: ruleset => {
        assign(metrics, "yaraRulesLoaded", ruleset.loaded ? ruleset.ruleCount : 0);
        assign(metrics, "yaraEngineAvailable", ruleset.available ? 1 : 0);
      }
    },
    httpServer: {
      handlerErrored: () => bump(metrics, "httpHandlerErrors"),
      rateLimitDropped: () => bump(metrics, "httpRateLimitDrops"),
      uptimeMs: now => now - metrics.startedAt
    }
  };
}

export type {
  ChannelLockRecoveryMetricRecorder,
  CommandMetricRecorder,
  CronMetricRecorder,
  HttpMetricRecorder,
  HttpServerMetricRecorder,
  InspectorMetricRecorder,
  MetricRecorders,
  OutboxDrainTotals,
  OutboxMetricRecorder,
  PermissionDelegationMetricRecorder,
  RedisMetricRecorder,
  ScheduledTaskMetricRecorder,
  SecurityMetricRecorder,
  ThreatSurfaceMetricRecorder,
  ThreatEngineMetricRecorder,
  ThreatEngineVersions
} from "../../shared/metricRecorderPorts.js";
