type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ParseEnvNumber = (name: string, defaultValue: number, limits: { min?: number; max?: number }) => number;
type AcquireDbLock = (jobName: string, ttlMs: number) => Promise<string | null>;
type ReleaseDbLock = (jobName: string, token: string) => Promise<unknown>;
type ErrorFormatter = (err: unknown) => string;
type TimerHandle = ReturnType<typeof setTimeout>;

interface MongooseLike {
  connection: {
    readyState: number;
  };
}

interface DiscordClientLike {
  isReady(): boolean;
}

interface LifecycleState {
  isShuttingDown: boolean;
}

interface OutboxMetricsLike {
  outboxSent: number;
  outboxRetried: number;
  outboxDeadLettered: number;
  outboxDrains: number;
  outboxQueueDepth: number;
}

interface OutboxDrainResult {
  sent?: number;
  retried?: number;
  deadLettered?: number;
  queued?: number;
}

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
  acquireDbLock, releaseDbLock, drainOutbox, lifecycle, metrics, errorMessage,
  drainLimit, perJobBudgetMs
}: CreateOutboxWorkerDeps): OutboxWorker {
  const intervalMs = parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS", 15_000, { min: 2_000, max: 600_000 });
  // TTL-ul lock-ului trebuie sa depaseasca durata in cel mai rau caz a unui drain
  // (drainLimit job-uri, fiecare pana la perJobBudgetMs din cauza rate-limiter-ului),
  // ca lock-ul sa nu expire mid-drain si alta instanta sa trimita dublu.
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
    metrics.outboxSent += r.sent ?? 0;
    metrics.outboxRetried += r.retried ?? 0;
    metrics.outboxDeadLettered += r.deadLettered ?? 0;
    if (typeof r.queued === "number") metrics.outboxQueueDepth = r.queued;
  }

  async function drainTick(): Promise<void> {
    if (lifecycle.isShuttingDown || draining) return;
    if (mongoose.connection.readyState !== 1 || !client.isReady()) {
      scheduleNext();
      return;
    }
    draining = true;
    let token: string | null = null;
    try {
      token = await acquireDbLock(OUTBOX_DRAIN_LOCK_NAME, lockTtlMs);
      if (!token) return;
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
