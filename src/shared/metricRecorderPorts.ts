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
  currentCycle(): number;
}

export interface OutboxDrainTotals {
  sent?: number;
  retried?: number;
  deadLettered?: number;
  expired?: number;
  deliveryMsTotal?: number;
  recoveryDuplicates?: number;
  recoveryFetches?: number;
  recoveryFailures?: number;
  recoveryMarkerMissing?: number;
  markSentFailures?: number;
  deleteFailures?: number;
  deadLetterFailures?: number;
  historyWriteFailures?: number;
  queued?: number;
  oldestJobAgeMs?: number;
  futureScheduledCount?: number;
  recoveryVerifyEnabledGuilds?: number;
}

export interface OutboxMetricRecorder {
  drained(totals: OutboxDrainTotals, at: number): void;
  pauseCheckFailed(): void;
  lockAcquireFailed(): void;
}

export interface CommandMetricRecorder {
  ran(command: string, durationMs: number): void;
  errored(command: string): void;
}

export interface ScheduledTaskMetricRecorder {
  ran(): void;
  failed(): void;
}

export interface ChannelLockRecoveryMetricRecorder extends ScheduledTaskMetricRecorder {
  converged(count: number): void;
}

export interface ThreatSurfaceMetricRecorder {
  reset(): void;
  reputationConfigured(configured: boolean): void;
  yaraRulesetObserved(ruleset: { loaded: boolean; available: boolean; ruleCount: number }): void;
}

export interface HttpServerMetricRecorder {
  handlerErrored(): void;
  rateLimitDropped(): void;
  uptimeMs(now: number): number;
}

export interface MetricRecorders {
  security: SecurityMetricRecorder;
  inspector: InspectorMetricRecorder;
  threatEngine: ThreatEngineMetricRecorder;
  permissionDelegation: PermissionDelegationMetricRecorder;
  http: HttpMetricRecorder;
  redis: RedisMetricRecorder;
  cron: CronMetricRecorder;
  outbox: OutboxMetricRecorder;
  command: CommandMetricRecorder;
  channelLockRecovery: ChannelLockRecoveryMetricRecorder;
  moderationCleanup: ScheduledTaskMetricRecorder;
  threatSurface: ThreatSurfaceMetricRecorder;
  httpServer: HttpServerMetricRecorder;
}
