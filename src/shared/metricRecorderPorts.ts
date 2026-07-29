"use strict";

export interface SecurityMetricRecorder {
  threatDeleted(): void;
  threatDeleteFailed(): void;
  botAddBlocked(): void;
  runtimeErrored(): void;
}

export interface InspectorMetricRecorder {
  sandboxApplied(active: boolean): void;
  processKilled(): void;
  processRestarted(total: number): void;
  scanTimedOut(): void;
}

export interface ThreatEngineVersions {
  engine: string;
  database: string;
}

export interface ThreatEngineMetricRecorder {
  scanned(at: number): void;
  knownVersions(): ThreatEngineVersions;
  versionsObserved(versions: ThreatEngineVersions): void;
  versionChanged(): void;
  probeFailed(reason: string): void;
}

export interface PermissionDelegationMetricRecorder {
  reverted(count?: number): void;
}

export interface HttpMetricRecorder {
  fetchSucceeded(): void;
  fetchFailed(): void;
  retried(): void;
  rateLimited(): void;
}

export interface RedisMetricRecorder {
  connected(): void;
  connectFailed(): void;
  cacheHit(): void;
  cacheMissed(): void;
  errored(): void;
}

export interface CronMetricRecorder {
  ran(): void;
  errored(): void;
  skippedByLock(): void;
  skippedByHealth(): void;
  aborted(): void;
}

export interface MetricRecorders {
  security: SecurityMetricRecorder;
  inspector: InspectorMetricRecorder;
  threatEngine: ThreatEngineMetricRecorder;
  permissionDelegation: PermissionDelegationMetricRecorder;
  http: HttpMetricRecorder;
  redis: RedisMetricRecorder;
  cron: CronMetricRecorder;
}
