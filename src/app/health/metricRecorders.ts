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
      aborted: () => bump(metrics, "cronAborted")
    }
  };
}

export type {
  CronMetricRecorder,
  HttpMetricRecorder,
  InspectorMetricRecorder,
  MetricRecorders,
  PermissionDelegationMetricRecorder,
  RedisMetricRecorder,
  SecurityMetricRecorder,
  ThreatEngineMetricRecorder,
  ThreatEngineVersions
} from "../../shared/metricRecorderPorts.js";
