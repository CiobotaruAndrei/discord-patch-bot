import type { RuntimeEnv } from "../../types.js";
import type { BotConfig, GameConfig } from "../../config/configTypes.js";
import type { BotMetrics } from "../health/metricsTypes.js";
import type { CronController } from "./schedulerTypes.js";
import { createCronHealthWindow } from "./cronHealthWindow.js";
import { computeCronDelay, resolveCronScheduleConfig } from "./cronScheduleConfig.js";
import { buildCronCycleJobs, runCronJobs } from "./cronJobRunner.js";
import { createRearmingTimer } from "./rearmingTimer.js";
import { createLockHeartbeat } from "./lockHeartbeat.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ParseEnvNumber = (name: string, defaultValue: number, limits: { min?: number; max?: number }) => number;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;
type AcquireDbLock = (jobName: string, ttlMs: number) => Promise<string | null>;
type RenewDbLock = (jobName: string, token: string, ttlMs: number) => Promise<boolean>;
type ReleaseDbLock = (jobName: string, token: string) => Promise<unknown>;

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
  user?: { id?: string } | null;
  channels: { fetch(channelId: string): Promise<unknown> | unknown };
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
  checkForYouTube(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  refreshPlayerCountSnapshots?(games: GameConfig[], shouldAbort: () => boolean, client?: DiscordClientLike): Promise<unknown>;
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

function createCronController({
  mongoose, performance, crypto, logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, commands, adminAlert,
  client, games, config, metrics, lifecycle, errorMessage, errorDetail,
  requestContext
}: CreateCronControllerDeps): CronController {
  const { cronIntervalMs, lockTtlMs, heartbeatIntervalMs, cronJitterMs, cronCycleBudgetMs } =
    resolveCronScheduleConfig(config, env, parseEnvNumber, logger);
  let shedDiscountsNextCycle = false;
  commands.setGlobalCacheTtl(Math.min(30 * 60 * 1000, cronIntervalMs));

  const health = createCronHealthWindow(env, logger);

  let currentCronAbortController: AbortController | null = null;
  const cronTimer = createRearmingTimer({
    isShuttingDown: () => lifecycle.isShuttingDown,
    delayMs: () => computeCronDelay(cronIntervalMs, cronJitterMs),
    onTick: runCronCycle
  });
  const heartbeat = createLockHeartbeat({
    lockName: "cron_main",
    renewDbLock,
    lockTtlMs,
    heartbeatIntervalMs,
    isShuttingDown: () => lifecycle.isShuttingDown,
    logger,
    logContext: "CRON_HEARTBEAT",
    errorMessage,
    onLost: () => currentCronAbortController?.abort()
  });

  function shouldAbortCron(): boolean {
    return lifecycle.isShuttingDown || (currentCronAbortController?.signal.aborted ?? false);
  }

  function scheduleNextCron(): void {
    cronTimer.schedule();
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
    if (health.shouldSkipForGlobalHealth()) {
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
      health.recordHealth(false, Math.round(performance.now() - lockAttemptStart));
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
    currentCronAbortController = new AbortController();
    heartbeat.start(lockToken);

    metrics.cronRuns++;
    const cycleStart = performance.now();
    let success = false;
    const cronReqId = `cron-${metrics.cronRuns}-${crypto.randomBytes(3).toString("hex")}`;
    await requestContext.run({ requestId: cronReqId, abortSignal: currentCronAbortController.signal }, async () => {
      try {
        const shedDiscounts = shedDiscountsNextCycle;
        shedDiscountsNextCycle = false;
        if (shedDiscounts) {
          logger("WARN", "CRON",
            `Ciclul anterior a depasit bugetul de ${cronCycleBudgetMs}ms; sar peste reduceri in ciclul #${metrics.cronRuns} pentru recuperare`);
        }
        logger("INFO", "CRON", `Pornire ciclu cron #${metrics.cronRuns}`);
        const jobs = buildCronCycleJobs(commands, client, games, shedDiscounts, shouldAbortCron);
        const failures = await runCronJobs(jobs);

        if (failures.length) {
          metrics.cronErrors++;
          for (const failure of failures) {
            logger("ERROR", "CRON", `Eroare in ciclul cron #${metrics.cronRuns} (${failure.label})`, errorDetail(failure.reason));
          }

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

        metrics.cronErrors++;
        logger("ERROR", "CRON", `Eroare in ciclul cron #${metrics.cronRuns}`, errorDetail(err));
        adminAlert("cron:fatal", `Eroare cron ciclu #${metrics.cronRuns}`, errorMessage(err)).catch(() => null);
      } finally {
        const durationMs = Math.round(performance.now() - cycleStart);
        health.recordHealth(success, durationMs);
        if (cronCycleBudgetMs > 0 && durationMs > cronCycleBudgetMs) shedDiscountsNextCycle = true;

        heartbeat.stop();
        await releaseDbLock("cron_main", lockToken).catch(() => null);
        currentCronAbortController = null;
        if (!lifecycle.isShuttingDown) scheduleNextCron();
      }
    });
  }

  function stop(): void {
    if (currentCronAbortController) currentCronAbortController.abort();
    cronTimer.stop();
    heartbeat.stop();
  }

  return { scheduleNextCron, runCronCycle, stop, shouldAbortCron, getHealthSnapshot: health.getHealthSnapshot };
}

export { createCronController, computeCronDelay };
export type { CreateCronControllerDeps };
