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

interface CreateOutboxWorkerDeps {
  mongoose: MongooseLike;
  client: DiscordClientLike;
  logger: Logger;
  parseEnvNumber: ParseEnvNumber;
  acquireDbLock: AcquireDbLock;
  releaseDbLock: ReleaseDbLock;
  drainOutbox: (client: DiscordClientLike) => Promise<unknown>;
  lifecycle: LifecycleState;
  errorMessage: ErrorFormatter;
}

interface OutboxWorker {
  start(): void;
  stop(): void;
  drainTick(): Promise<void>;
}

const OUTBOX_DRAIN_LOCK_NAME = "outbox_drain";

function createOutboxWorker({
  mongoose, client, logger, parseEnvNumber,
  acquireDbLock, releaseDbLock, drainOutbox, lifecycle, errorMessage
}: CreateOutboxWorkerDeps): OutboxWorker {
  const intervalMs = parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS", 15_000, { min: 2_000, max: 600_000 });
  const lockTtlMs = Math.max(intervalMs * 4, 120_000);

  let timerId: TimerHandle | null = null;
  let draining = false;

  function scheduleNext(): void {
    if (lifecycle.isShuttingDown) return;
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(drainTick, intervalMs);
    if (typeof timerId.unref === "function") timerId.unref();
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
      await drainOutbox(client);
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
    logger("INFO", "OUTBOX", `Worker outbox pornit (interval ${intervalMs}ms)`);
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
