"use strict";

import { createScheduledTaskRunner, type ScheduledTaskRunner } from "./scheduledTaskRunner.js";
import type { ChannelLockRecoveryMetricRecorder } from "../../shared/metricRecorderPorts.js";

export interface CreateChannelLockRecoveryTaskDeps {
  runRecoveryCycle(): Promise<{ converged: number }>;
  metrics: ChannelLockRecoveryMetricRecorder;
  logger(level: string, context: string, message: string, meta?: unknown): void;
  adminAlert(kind: string, title: string, body: string): Promise<unknown>;
  errorMessage(err: unknown): string;
  errorDetail(err: unknown): string;
  intervalMs?: number;
  alertAfterConsecutiveFailures?: number;
}

export const CHANNEL_LOCK_RECOVERY_INTERVAL_MS = 2 * 60 * 1000;
const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

export function createChannelLockRecoveryTask(deps: CreateChannelLockRecoveryTaskDeps): ScheduledTaskRunner {
  const alertThreshold = deps.alertAfterConsecutiveFailures ?? ALERT_AFTER_CONSECUTIVE_FAILURES;
  let consecutiveFailures = 0;
  return createScheduledTaskRunner({
    intervalMs: deps.intervalMs ?? CHANNEL_LOCK_RECOVERY_INTERVAL_MS,
    task: async () => {
      const totals = await deps.runRecoveryCycle();
      deps.metrics.converged(totals.converged);
    },
    onResult: result => {
      if (result.status === "completed") {
        consecutiveFailures = 0;
        deps.metrics.ran();
        return;
      }
      if (result.status !== "failed") return;
      consecutiveFailures++;
      deps.metrics.failed();
      deps.logger("ERROR", "LOCK_CHANNEL_RECOVERY", "Ciclul de recovery pentru divergentele lock/unlock a esuat", deps.errorDetail(result.error));
      if (consecutiveFailures >= alertThreshold) {
        deps.adminAlert(
          "security:lock-recovery",
          "Recovery-ul divergentelor lock/unlock esueaza repetat",
          deps.errorMessage(result.error)
        ).catch(() => null);
        consecutiveFailures = 0;
      }
    }
  });
}

export default { createChannelLockRecoveryTask, CHANNEL_LOCK_RECOVERY_INTERVAL_MS };
