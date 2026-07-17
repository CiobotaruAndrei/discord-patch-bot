"use strict";

import { createScheduledTaskRunner, type ScheduledTaskRunner } from "./scheduledTaskRunner.js";

type CleanupMetrics = { moderationCleanupRuns?: number; moderationCleanupFailures?: number };

export interface CreateModerationCleanupTaskDeps {
  cleanupExpired(): Promise<void>;
  metrics: CleanupMetrics;
  logger(level: string, context: string, message: string, meta?: unknown): void;
  adminAlert(kind: string, title: string, body: string): Promise<unknown>;
  errorMessage(err: unknown): string;
  errorDetail(err: unknown): string;
  intervalMs?: number;
  alertAfterConsecutiveFailures?: number;
}

export const MODERATION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

export function createModerationCleanupTask(deps: CreateModerationCleanupTaskDeps): ScheduledTaskRunner {
  const alertThreshold = deps.alertAfterConsecutiveFailures ?? ALERT_AFTER_CONSECUTIVE_FAILURES;
  let consecutiveFailures = 0;
  return createScheduledTaskRunner({
    intervalMs: deps.intervalMs ?? MODERATION_CLEANUP_INTERVAL_MS,
    task: () => deps.cleanupExpired(),
    onResult: result => {
      if (result.status === "completed") {
        consecutiveFailures = 0;
        deps.metrics.moderationCleanupRuns = (deps.metrics.moderationCleanupRuns ?? 0) + 1;
        return;
      }
      if (result.status !== "failed") return;
      consecutiveFailures++;
      deps.metrics.moderationCleanupFailures = (deps.metrics.moderationCleanupFailures ?? 0) + 1;
      deps.logger("ERROR", "MODERATION_LIFECYCLE", "Curatarea periodica a sanctiunilor expirate a esuat", deps.errorDetail(result.error));
      if (consecutiveFailures >= alertThreshold) {
        deps.adminAlert(
          "moderation:cleanup-periodic",
          "Curatarea periodica a sanctiunilor esueaza repetat",
          deps.errorMessage(result.error)
        ).catch(() => null);
        consecutiveFailures = 0;
      }
    }
  });
}

export default { createModerationCleanupTask, MODERATION_CLEANUP_INTERVAL_MS };
