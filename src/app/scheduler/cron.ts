import type {
  BotConfig,
  BotMetrics,
  CronController,
  CronHealthSnapshot,
  GameConfig,
  RuntimeEnv
} from "../../types";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ParseEnvNumber = (name: string, defaultValue: number, limits: { min?: number; max?: number }) => number;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;
type AcquireDbLock = (jobName: string, ttlMs: number) => Promise<string | null>;
type RenewDbLock = (jobName: string, token: string, ttlMs: number) => Promise<boolean>;
type ReleaseDbLock = (jobName: string, token: string) => Promise<unknown>;
type TimerHandle = ReturnType<typeof setTimeout>;

interface MongooseLike {
  connection: {
    readyState: number;
  };
}

interface PerformanceLike {
  now(): number;
}

interface CryptoLike {
  randomBytes(size: number): {
    toString(encoding: BufferEncoding): string;
  };
}

interface DiscordClientLike {
  isReady(): boolean;
}

interface LifecycleState {
  isShuttingDown: boolean;
}

interface RequestContextStore {
  requestId: string;
  abortSignal?: AbortSignal;
}

interface RequestContext {
  run<T>(store: RequestContextStore, callback: () => Promise<T>): Promise<T>;
}

interface CronCommands {
  setGlobalCacheTtl(ms: number): void;
  checkForUpdates(client: DiscordClientLike, games: GameConfig[], shouldAbort: () => boolean): Promise<void>;
  checkForDiscounts(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
}

interface CreateCronControllerDeps {
  mongoose: MongooseLike;
  performance: PerformanceLike;
  crypto: CryptoLike;
  logger: Logger;
  env: RuntimeEnv;
  parseEnvNumber: ParseEnvNumber;
  acquireDbLock: AcquireDbLock;
  renewDbLock: RenewDbLock;
  releaseDbLock: ReleaseDbLock;
  commands: CronCommands;
  adminAlert: AdminAlert;
  client: DiscordClientLike;
  games: GameConfig[];
  config: BotConfig;
  metrics: BotMetrics;
  lifecycle: LifecycleState;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
  requestContext: RequestContext;
}

interface HealthEntry {
  success: boolean;
  durationMs: number;
}

function createCronController({
  mongoose, performance, crypto, logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, commands, adminAlert,
  client, games, config, metrics, lifecycle, errorMessage, errorDetail,
  requestContext
}: CreateCronControllerDeps): CronController {
  const allowedIntervals = new Set([
    10 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000
  ]);
  const configuredIntervalMinutes = config.checkIntervalMinutes;
  const configIntervalMs = typeof configuredIntervalMinutes === "number"
    && Number.isFinite(configuredIntervalMinutes)
    && configuredIntervalMinutes > 0
    ? Math.round(configuredIntervalMinutes * 60 * 1000)
    : 30 * 60 * 1000;
  const requestedIntervalMs = parseEnvNumber("CRON_INTERVAL_MS", configIntervalMs, {
    min: 10 * 60 * 1000,
    max: 60 * 60 * 1000
  });
  const cronIntervalMs = allowedIntervals.has(requestedIntervalMs) ? requestedIntervalMs : configIntervalMs;
  if (requestedIntervalMs !== cronIntervalMs) {
    logger("WARN", "CONFIG",
      `CRON_INTERVAL_MS=${requestedIntervalMs} nu este intr-o valoare suportata ` +
      `(10/15/30/60 min). Folosesc default ${configIntervalMs}.`);
  }

  const lockTtlMs = Math.max(cronIntervalMs + 60_000, 5 * 60 * 1000);
  const heartbeatIntervalMs = Math.max(15_000, Math.floor(lockTtlMs / 3));
  commands.setGlobalCacheTtl(Math.min(30 * 60 * 1000, cronIntervalMs));

  let cronTimerId: TimerHandle | null = null;
  let heartbeatTimerId: TimerHandle | null = null;
  let currentCronAbortController: AbortController | null = null;
  let currentCronToken: string | null = null;
  const healthWindow: HealthEntry[] = [];
  let healthSkipScheduled = false;

  function recordHealth(success: boolean, durationMs: number): void {
    healthWindow.push({ success, durationMs });
    if (healthWindow.length > env.GLOBAL_HEALTH_WINDOW) healthWindow.shift();
  }

  function shouldSkipForGlobalHealth(): boolean {
    if (healthSkipScheduled) {
      healthSkipScheduled = false;
      healthWindow.length = 0;
      return false;
    }
    if (healthWindow.length < env.GLOBAL_HEALTH_WINDOW) return false;
    const successCount = healthWindow.filter(entry => entry.success).length;
    const ratio = (successCount / healthWindow.length) * 100;
    if (ratio < env.GLOBAL_HEALTH_MIN_RATIO) {
      healthSkipScheduled = true;
      logger("WARN", "CRON_HEALTH",
        `Global health rate ${ratio.toFixed(0)}% < ${env.GLOBAL_HEALTH_MIN_RATIO}% in ultimele ${healthWindow.length} cicluri. ` +
        "Sar ciclul curent pentru backoff.");
      return true;
    }
    return false;
  }

  function getHealthSnapshot(): CronHealthSnapshot {
    if (!healthWindow.length) {
      return { successRatio: null, windowSize: 0, healthSkipScheduled };
    }
    const successCount = healthWindow.filter(entry => entry.success).length;
    const totalDurationMs = healthWindow.reduce((sum, entry) => sum + entry.durationMs, 0);
    return {
      successRatio: Math.round((successCount / healthWindow.length) * 100),
      windowSize: healthWindow.length,
      healthSkipScheduled,
      avgDurationMs: Math.round(totalDurationMs / healthWindow.length)
    };
  }

  function shouldAbortCron(): boolean {
    return lifecycle.isShuttingDown || (currentCronAbortController?.signal.aborted ?? false);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimerId) {
      clearTimeout(heartbeatTimerId);
      heartbeatTimerId = null;
    }
  }

  // V11: heartbeat tolerance pentru erori transient. Inainte, orice throw din
  // renewDbLock (acum infrastructure errors propaga, dupa fix-ul din locks.ts)
  // era doar log-uit, iar `!renewed` era abort imediat — chiar daca Mongo doar
  // tremura un tick. heartbeatIntervalMs = lockTtlMs / 3, deci avem 2 ticks
  // intregi inainte ca lock-ul sa expire pe Mongo. Toleram primul throw
  // (log + retry) si abort-am la al doilea throw consecutiv — la momentul
  // acela mai avem 1/3 din TTL ca buffer inainte ca alta instanta sa preia
  // lock-ul. `false` ramane abort imediat (lock-ul a fost deja preluat de
  // alta instanta — corectitudine, nu blip).
  const HEARTBEAT_ABORT_AT_CONSECUTIVE_ERRORS = 2;
  function startHeartbeat(lockToken: string): void {
    stopHeartbeat();
    let consecutiveErrors = 0;
    const tick = async (): Promise<void> => {
      if (lifecycle.isShuttingDown || currentCronToken !== lockToken) return;
      try {
        const renewed = await renewDbLock("cron_main", lockToken, lockTtlMs);
        if (!renewed) {
          logger("WARN", "CRON_HEARTBEAT", "Lock-ul cron nu a putut fi reinnoit, anulez ciclul");
          if (currentCronAbortController) currentCronAbortController.abort();
          return;
        }
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= HEARTBEAT_ABORT_AT_CONSECUTIVE_ERRORS) {
          logger("WARN", "CRON_HEARTBEAT",
            `Reinnoire lock esuata ${consecutiveErrors} ticks consecutiv, anulez ciclul`,
            errorMessage(err));
          if (currentCronAbortController) currentCronAbortController.abort();
          return;
        }
        logger("WARN", "CRON_HEARTBEAT",
          `Eroare la reinnoirea lock-ului (${consecutiveErrors}/${HEARTBEAT_ABORT_AT_CONSECUTIVE_ERRORS}), retry`,
          errorMessage(err));
      }
      if (!lifecycle.isShuttingDown && currentCronToken === lockToken) {
        heartbeatTimerId = setTimeout(tick, heartbeatIntervalMs);
        if (typeof heartbeatTimerId.unref === "function") heartbeatTimerId.unref();
      }
    };
    heartbeatTimerId = setTimeout(tick, heartbeatIntervalMs);
    if (typeof heartbeatTimerId.unref === "function") heartbeatTimerId.unref();
  }

  function scheduleNextCron(): void {
    if (lifecycle.isShuttingDown) return;
    if (cronTimerId) clearTimeout(cronTimerId);
    cronTimerId = setTimeout(runCronCycle, cronIntervalMs);
    if (typeof cronTimerId.unref === "function") cronTimerId.unref();
  }

  async function runCronCycle(): Promise<void> {
    if (lifecycle.isShuttingDown) return;
    if (mongoose.connection.readyState !== 1) {
      logger("WARN", "CRON", "Mongo nu e conectat, sar peste ciclul curent");
      scheduleNextCron();
      return;
    }
    if (!client.isReady()) {
      logger("WARN", "CRON", "Discord client nu e ready, sar peste ciclu");
      scheduleNextCron();
      return;
    }
    if (shouldSkipForGlobalHealth()) {
      metrics.cronSkippedDueToHealth = (metrics.cronSkippedDueToHealth || 0) + 1;
      scheduleNextCron();
      return;
    }

    const lockAttemptStart = performance.now();
    let lockToken: string | null;
    try {
      lockToken = await acquireDbLock("cron_main", lockTtlMs);
    } catch (err) {
      metrics.cronErrors++;
      recordHealth(false, Math.round(performance.now() - lockAttemptStart));
      logger("ERROR", "CRON", "Nu am putut obtine lock-ul cron", errorDetail(err));
      adminAlert("cron:lock", "Botul nu a putut obtine lock-ul cron", errorMessage(err)).catch(() => null);
      scheduleNextCron();
      return;
    }

    if (!lockToken) {
      metrics.cronSkippedDueToLock++;
      logger("INFO", "CRON", "Lock cron detinut de alta instanta, sar peste ciclu");
      scheduleNextCron();
      return;
    }
    currentCronToken = lockToken;
    currentCronAbortController = new AbortController();
    startHeartbeat(lockToken);

    metrics.cronRuns++;
    const cycleStart = performance.now();
    let success = false;
    const cronReqId = `cron-${metrics.cronRuns}-${crypto.randomBytes(3).toString("hex")}`;
    await requestContext.run({ requestId: cronReqId, abortSignal: currentCronAbortController.signal }, async () => {
      try {
        logger("INFO", "CRON", `Pornire ciclu cron #${metrics.cronRuns}`);
        // V11: Promise.allSettled in loc de Promise.all. Cu Promise.all, daca
        // checkForUpdates respingea, cycle-ul intra in catch imediat, dar
        // checkForDiscounts continua sa ruleze in background — orfan, dupa ce
        // finally a eliberat deja lock-ul si a stins heartbeat-ul. Allsettled
        // ne lasa sa asteptam ambele si sa contorizam erorile corect inainte
        // de release.
        const [updatesResult, discountsResult] = await Promise.allSettled([
          commands.checkForUpdates(client, games, shouldAbortCron),
          commands.checkForDiscounts(client, shouldAbortCron)
        ]);
        const failures: Array<{ label: string; reason: unknown }> = [];
        if (updatesResult.status === "rejected") failures.push({ label: "checkForUpdates", reason: updatesResult.reason });
        if (discountsResult.status === "rejected") failures.push({ label: "checkForDiscounts", reason: discountsResult.reason });

        if (failures.length) {
          metrics.cronErrors++;
          for (const failure of failures) {
            logger("ERROR", "CRON", `Eroare in ciclul cron #${metrics.cronRuns} (${failure.label})`, errorDetail(failure.reason));
          }
          // Combine reasons into a single admin alert so an outage in both jobs
          // doesn't double-spam the cron:fatal cooldown bucket.
          const combinedMessage = failures.map(f => `${f.label}: ${errorMessage(f.reason)}`).join(" | ");
          adminAlert("cron:fatal", `Eroare cron ciclu #${metrics.cronRuns}`, combinedMessage).catch(() => null);
        } else if (currentCronAbortController?.signal.aborted) {
          metrics.cronAborted++;
          logger("WARN", "CRON", "Ciclu abandonat (shutdown sau abort)");
        } else {
          success = true;
          const ms = Math.round(performance.now() - cycleStart);
          logger("INFO", "CRON", `Ciclu cron #${metrics.cronRuns} finalizat in ${ms}ms`);
        }
      } catch (err) {
        // Pastrat ca safety net pentru orice throw sincron neasteptat din
        // requestContext.run sau din logica de mai sus — Promise.allSettled in
        // sine nu mai arunca pentru rejecturi.
        metrics.cronErrors++;
        logger("ERROR", "CRON", `Eroare in ciclul cron #${metrics.cronRuns}`, errorDetail(err));
        adminAlert("cron:fatal", `Eroare cron ciclu #${metrics.cronRuns}`, errorMessage(err)).catch(() => null);
      } finally {
        const durationMs = Math.round(performance.now() - cycleStart);
        recordHealth(success, durationMs);
        stopHeartbeat();
        await releaseDbLock("cron_main", lockToken).catch(() => null);
        currentCronToken = null;
        currentCronAbortController = null;
        if (!lifecycle.isShuttingDown) scheduleNextCron();
      }
    });
  }

  function stop(): void {
    if (currentCronAbortController) currentCronAbortController.abort();
    if (cronTimerId) {
      clearTimeout(cronTimerId);
      cronTimerId = null;
    }
    stopHeartbeat();
  }

  return { scheduleNextCron, runCronCycle, stop, shouldAbortCron, getHealthSnapshot };
}

export { createCronController };
