type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ParseEnvNumber = (name: string, defaultValue: number, limits: { min?: number; max?: number }) => number;
type AcquireDbLock = (jobName: string, ttlMs: number) => Promise<string | null>;
type RenewDbLock = (jobName: string, token: string, ttlMs: number) => Promise<boolean>;
type ReleaseDbLock = (jobName: string, token: string) => Promise<void>;
type ErrorFormatter = (err: unknown) => string;

import type { OutboxDiscordClient } from "../../features/notifications/outboundChannel.js";
import type { OutboxMetricRecorder } from "../../shared/metricRecorderPorts.js";
import { createRearmingTimer } from "./rearmingTimer.js";
import { createLockHeartbeat } from "./lockHeartbeat.js";

interface MongooseLike {
  connection: {
    readyState: number;
  };
}

type DiscordClientLike = OutboxDiscordClient;

interface LifecycleState {
  isShuttingDown: boolean;
}

interface OutboxMetricsLike {
  outboxSent: number;
  outboxRetried: number;
  outboxDeadLettered: number;
  outboxExpired: number;
  outboxDrains: number;
  outboxQueueDepth: number;
  outboxDeliveryMsTotal: number;
  outboxOldestJobAgeSeconds: number;
  outboxFutureScheduledJobs: number;
  outboxLockAcquireFailures: number;
  outboxPauseCheckFailures: number;
  outboxRecoveryDuplicates: number;
  outboxRecoveryFetches: number;
  outboxRecoveryFailures: number;
  outboxRecoveryMarkerMissing: number;
  outboxMarkSentFailures: number;
  outboxDeleteFailures: number;
  outboxDeadLetterWriteFailures: number;
  outboxHistoryWriteFailures: number;
  outboxRecoveryVerifyEnabledGuilds: number;
  outboxLastDrainAt: number;
}

interface OutboxDrainResult {
  sent?: number;
  retried?: number;
  deadLettered?: number;
  expired?: number;
  queued?: number;
  deliveryMsTotal?: number;
  oldestJobAgeMs?: number;
  futureScheduledCount?: number;
  recoveryDuplicates?: number;
  recoveryFetches?: number;
  recoveryFailures?: number;
  recoveryMarkerMissing?: number;
  markSentFailures?: number;
  deleteFailures?: number;
  deadLetterFailures?: number;
  historyWriteFailures?: number;
  recoveryVerifyEnabledGuilds?: number;
}

type AdminAlert = (kind: string, title: string, body: string) => Promise<void>;

interface CreateOutboxWorkerDeps {
  mongoose: MongooseLike;
  client: DiscordClientLike;
  logger: Logger;
  parseEnvNumber: ParseEnvNumber;
  acquireDbLock: AcquireDbLock;
  renewDbLock: RenewDbLock;
  releaseDbLock: ReleaseDbLock;
  drainOutbox: (client: DiscordClientLike, shouldAbort?: () => boolean) => Promise<OutboxDrainResult>;
  lifecycle: LifecycleState;
  metrics: OutboxMetricRecorder;
  errorMessage: ErrorFormatter;
  adminAlert: AdminAlert;
  isPaused?: () => Promise<boolean>;
  drainLimit: number;
  perJobBudgetMs: number;
}

interface OutboxWorker {
  start(): void;
  stop(): void;
  drainTick(): Promise<void>;
}

const OUTBOX_DRAIN_LOCK_NAME = "outbox_drain";
const OUTBOX_LOCK_MIN_TTL_MS = 120_000;
const OUTBOX_LOCK_MAX_TTL_MS = 3_600_000;

function createOutboxWorker({
  mongoose, client, logger, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, drainOutbox, lifecycle, metrics, errorMessage, adminAlert, isPaused,
  drainLimit, perJobBudgetMs
}: CreateOutboxWorkerDeps): OutboxWorker {
  const intervalMs = parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS", 15_000, { min: 2_000, max: 600_000 });
  const worstCaseDrainMs = Math.max(drainLimit, 1) * Math.max(perJobBudgetMs, 1);
  const defaultLockTtlMs = Math.min(
    OUTBOX_LOCK_MAX_TTL_MS,
    Math.max(intervalMs * 4, worstCaseDrainMs, OUTBOX_LOCK_MIN_TTL_MS)
  );
  const lockTtlMs = parseEnvNumber("NOTIFICATION_OUTBOX_LOCK_TTL_MS", defaultLockTtlMs, {
    min: OUTBOX_LOCK_MIN_TTL_MS,
    max: OUTBOX_LOCK_MAX_TTL_MS
  });
  const heartbeatIntervalMs = Math.max(15_000, Math.floor(lockTtlMs / 3));

  let draining = false;
  let lostLock = false;
  const timer = createRearmingTimer({
    isShuttingDown: () => lifecycle.isShuttingDown,
    delayMs: () => intervalMs,
    onTick: drainTick
  });
  const heartbeat = createLockHeartbeat({
    lockName: OUTBOX_DRAIN_LOCK_NAME,
    renewDbLock,
    lockTtlMs,
    heartbeatIntervalMs,
    isShuttingDown: () => lifecycle.isShuttingDown,
    logger,
    logContext: "OUTBOX_HEARTBEAT",
    errorMessage,
    onLost: () => { lostLock = true; }
  });

  function recordDrain(r: OutboxDrainResult): void {
    metrics.drained(r, Date.now());

    if ((r.recoveryFailures ?? 0) > 0) {
      adminAlert("outbox:recovery-read",
        "Recovery verify activ, dar nu pot citi istoricul canalului",
        "Verifica permisiunea Read Message History pentru canalele de notificari.").catch(() => undefined);
    }
    if ((r.markSentFailures ?? 0) > 0) {
      adminAlert("outbox:mark-sent",
        "Marcarea livrarilor outbox in istoric esueaza",
        "Mesaje au fost trimise dar nu s-au putut marca in notificationOutboxSent; risc de duplicare la recovery.").catch(() => undefined);
    }
    if ((r.deleteFailures ?? 0) > 0) {
      adminAlert("outbox:delete",
        "Stergerea job-urilor outbox dupa procesare esueaza",
        "Job-uri procesate nu s-au putut sterge din coada; raman deduse/reluate, dar verifica disponibilitatea Mongo.").catch(() => undefined);
    }
    if ((r.deadLetterFailures ?? 0) > 0) {
      adminAlert("outbox:deadletter-write",
        "Scrierea auditului dead-letter la expirare esueaza",
        "Job-uri expirate NU au fost sterse fiindca auditul dead-letter a esuat (payload-ul de replay e pastrat); raman in coada pana se reia auditul. Verifica disponibilitatea Mongo / colectia de dead-letter.").catch(() => undefined);
    }
    if ((r.historyWriteFailures ?? 0) > 0) {
      adminAlert("outbox:history-write",
        "Scrierea notificationHistory esueaza pentru livrari reusite",
        "Mesaje au fost trimise dar nu s-au putut scrie in notificationHistory; livrarea e OK, dar istoricul intern poate fi incomplet. Verifica disponibilitatea Mongo si colectia de istoric.").catch(() => undefined);
    }
  }

  async function drainTick(): Promise<void> {
    if (lifecycle.isShuttingDown || draining) return;
    if (mongoose.connection.readyState !== 1 || !client.isReady() || !client.user?.id) {
      timer.schedule();
      return;
    }
    if (isPaused) {
      let paused: boolean;
      try {
        paused = await isPaused();
      } catch (err) {
        metrics.pauseCheckFailed();
        logger("WARN", "OUTBOX", "Citirea flagului de pauza a esuat; skip cycle (fail-closed, nu drenez)", errorMessage(err));
        timer.schedule();
        return;
      }
      if (paused) {
        timer.schedule();
        return;
      }
    }
    draining = true;
    let token: string | null = null;
    try {
      token = await acquireDbLock(OUTBOX_DRAIN_LOCK_NAME, lockTtlMs);
      if (!token) {
        metrics.lockAcquireFailed();
        return;
      }
      lostLock = false;
      heartbeat.start(token);
      recordDrain(await drainOutbox(client, () => lostLock || lifecycle.isShuttingDown));
    } catch (err) {
      logger("WARN", "OUTBOX", "Drain outbox (worker) esuat", errorMessage(err));
    } finally {
      heartbeat.stop();
      if (token) await releaseDbLock(OUTBOX_DRAIN_LOCK_NAME, token).catch(() => null);
      draining = false;
      timer.schedule();
    }
  }

  function start(): void {
    if (timer.isActive() || lifecycle.isShuttingDown) return;
    logger("INFO", "OUTBOX", `Worker outbox pornit (interval ${intervalMs}ms, lock TTL ${lockTtlMs}ms)`);
    timer.schedule();
  }

  function stop(): void {
    timer.stop();
  }

  return { start, stop, drainTick };
}

export { createOutboxWorker, OUTBOX_DRAIN_LOCK_NAME };
export type { CreateOutboxWorkerDeps, OutboxDrainResult, OutboxWorker };
