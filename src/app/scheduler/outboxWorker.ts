type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ParseEnvNumber = (name: string, defaultValue: number, limits: { min?: number; max?: number }) => number;
type AcquireDbLock = (jobName: string, ttlMs: number) => Promise<string | null>;
type ReleaseDbLock = (jobName: string, token: string) => Promise<unknown>;
type ErrorFormatter = (err: unknown) => string;
type TimerHandle = ReturnType<typeof setTimeout>;

import type { OutboxDiscordClient } from "../../features/notifications/outboundChannel";

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
  outboxLockAcquireFailures: number;
  outboxRecoveryDuplicates: number;
  outboxRecoveryFetches: number;
  outboxRecoveryFailures: number;
  outboxRecoveryMarkerMissing: number;
  outboxMarkSentFailures: number;
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
  recoveryDuplicates?: number;
  recoveryFetches?: number;
  recoveryFailures?: number;
  recoveryMarkerMissing?: number;
  markSentFailures?: number;
  deleteFailures?: number;
  recoveryVerifyEnabledGuilds?: number;
}

type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;

interface CreateOutboxWorkerDeps {
  mongoose: MongooseLike;
  client: DiscordClientLike;
  logger: Logger;
  parseEnvNumber: ParseEnvNumber;
  acquireDbLock: AcquireDbLock;
  releaseDbLock: ReleaseDbLock;
  drainOutbox: (client: DiscordClientLike) => Promise<OutboxDrainResult | unknown>;
  lifecycle: LifecycleState;
  metrics: OutboxMetricsLike;
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
  acquireDbLock, releaseDbLock, drainOutbox, lifecycle, metrics, errorMessage, adminAlert, isPaused,
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

  let timerId: TimerHandle | null = null;
  let draining = false;

  function scheduleNext(): void {
    if (lifecycle.isShuttingDown) return;
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(drainTick, intervalMs);
    if (typeof timerId.unref === "function") timerId.unref();
  }

  function recordDrain(result: OutboxDrainResult | unknown): void {
    const r = (result && typeof result === "object" ? result : {}) as OutboxDrainResult;
    metrics.outboxDrains++;
    metrics.outboxLastDrainAt = Date.now();
    metrics.outboxSent += r.sent ?? 0;
    metrics.outboxRetried += r.retried ?? 0;
    metrics.outboxDeadLettered += r.deadLettered ?? 0;
    metrics.outboxExpired += r.expired ?? 0;
    metrics.outboxDeliveryMsTotal += r.deliveryMsTotal ?? 0;
    metrics.outboxRecoveryDuplicates += r.recoveryDuplicates ?? 0;
    metrics.outboxRecoveryFetches += r.recoveryFetches ?? 0;
    metrics.outboxRecoveryFailures += r.recoveryFailures ?? 0;
    metrics.outboxRecoveryMarkerMissing += r.recoveryMarkerMissing ?? 0;
    metrics.outboxMarkSentFailures += r.markSentFailures ?? 0;
    if (typeof r.queued === "number") metrics.outboxQueueDepth = r.queued;
    if (typeof r.oldestJobAgeMs === "number") metrics.outboxOldestJobAgeSeconds = Math.round(r.oldestJobAgeMs / 1000);
    if (typeof r.recoveryVerifyEnabledGuilds === "number") metrics.outboxRecoveryVerifyEnabledGuilds = r.recoveryVerifyEnabledGuilds;

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
  }

  async function drainTick(): Promise<void> {
    if (lifecycle.isShuttingDown || draining) return;
    if (mongoose.connection.readyState !== 1 || !client.isReady() || !client.user?.id) {
      scheduleNext();
      return;
    }
    if (isPaused && await isPaused().catch(() => false)) {
      scheduleNext();
      return;
    }
    draining = true;
    let token: string | null = null;
    try {
      token = await acquireDbLock(OUTBOX_DRAIN_LOCK_NAME, lockTtlMs);
      if (!token) {
        metrics.outboxLockAcquireFailures++;
        return;
      }
      recordDrain(await drainOutbox(client));
    } catch (err) {
      logger("WARN", "OUTBOX", "Drain outbox (worker) esuat", errorMessage(err));
    } finally {
      if (token) await releaseDbLock(OUTBOX_DRAIN_LOCK_NAME, token).catch(() => null);
      draining = false;
      scheduleNext();
    }
  }

  function start(): void {
    if (timerId || lifecycle.isShuttingDown) return;
    logger("INFO", "OUTBOX", `Worker outbox pornit (interval ${intervalMs}ms, lock TTL ${lockTtlMs}ms)`);
    scheduleNext();
  }

  function stop(): void {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  return { start, stop, drainTick };
}

export { createOutboxWorker, OUTBOX_DRAIN_LOCK_NAME };
export type { CreateOutboxWorkerDeps, OutboxWorker };
