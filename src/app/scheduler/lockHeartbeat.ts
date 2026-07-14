type TimerHandle = ReturnType<typeof setTimeout>;
type HeartbeatLogger = (level: string, context: string, message: string, meta?: unknown) => void;
type RenewDbLock = (jobName: string, token: string, ttlMs: number) => Promise<boolean>;
type ErrorFormatter = (err: unknown) => string;

interface LockHeartbeatDeps {
  lockName: string;
  renewDbLock: RenewDbLock;
  lockTtlMs: number;
  heartbeatIntervalMs: number;
  isShuttingDown: () => boolean;
  logger: HeartbeatLogger;
  logContext: string;
  errorMessage: ErrorFormatter;
  onLost: () => void;
  abortAtConsecutiveErrors?: number;
}

interface LockHeartbeat {
  start(token: string): void;
  stop(): void;
}

function createLockHeartbeat(deps: LockHeartbeatDeps): LockHeartbeat {
  const { lockName, renewDbLock, lockTtlMs, heartbeatIntervalMs, isShuttingDown, logger, logContext, errorMessage, onLost } = deps;
  const abortAt = deps.abortAtConsecutiveErrors ?? 2;
  let timerId: TimerHandle | null = null;
  let activeToken: string | null = null;

  function stop(): void {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    activeToken = null;
  }

  function start(token: string): void {
    if (timerId) clearTimeout(timerId);
    activeToken = token;
    let consecutiveErrors = 0;
    const tick = async (): Promise<void> => {
      if (isShuttingDown() || activeToken !== token) return;
      try {
        const renewed = await renewDbLock(lockName, token, lockTtlMs);
        if (!renewed) {
          logger("WARN", logContext, `Lock-ul ${lockName} nu a putut fi reinnoit, anulez ciclul`);
          onLost();
          return;
        }
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= abortAt) {
          logger("WARN", logContext, `Reinnoire lock ${lockName} esuata ${consecutiveErrors} ticks consecutiv, anulez ciclul`, errorMessage(err));
          onLost();
          return;
        }
        logger("WARN", logContext, `Eroare la reinnoirea lock-ului ${lockName} (${consecutiveErrors}/${abortAt}), retry`, errorMessage(err));
      }
      if (!isShuttingDown() && activeToken === token) {
        timerId = setTimeout(tick, heartbeatIntervalMs);
        if (typeof timerId.unref === "function") timerId.unref();
      }
    };
    timerId = setTimeout(tick, heartbeatIntervalMs);
    if (typeof timerId.unref === "function") timerId.unref();
  }

  return { start, stop };
}

export { createLockHeartbeat };
export type { LockHeartbeat, LockHeartbeatDeps };
