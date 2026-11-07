import type { ActiveLocks, LifecycleState } from "../../types.js";
import type { CronController } from "../scheduler/schedulerTypes.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { IngressActivityTracker } from "./ingressActivityTracker.js";

type ShutdownLogger = (level: "INFO" | "WARN" | "ERROR", context: string, message: string, meta?: unknown) => void;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;

type ShutdownSignal = NodeJS.Signals | "uncaughtException" | "unhandledRejection" | string;

interface DiscordClientLike {
  destroy(): void | Promise<void>;
}

interface MongooseLike {
  connection: {
    close(): Promise<void>;
  };
}

interface HttpServerLike {

  close(callback?: (err?: Error) => void): unknown;
}

interface HousekeepingLike {
  stop(): void | Promise<void>;
}

type StopStatus = "stopped" | "timed-out" | "failed";

interface StopOutcome {
  component: string;
  status: StopStatus;
}

const STOP_BUDGET_MS = 5000;

interface ShutdownController {
  shutdown(signal: ShutdownSignal, exitCode?: number): Promise<void>;
  handleFatalProcessError(kind: "uncaughtException" | "unhandledRejection", reason: unknown): void;
  registerProcessHandlers(): void;
}

interface CreateShutdownControllerDeps {
  lifecycle: LifecycleState;
  logger: ShutdownLogger;
  env: Pick<RuntimeEnv, "SHUTDOWN_DRAIN_MS">;
  client: DiscordClientLike;
  mongoose: MongooseLike;
  httpServer: HttpServerLike;
  activeLocks: ActiveLocks;
  ingress?: Pick<IngressActivityTracker, "activeCount" | "activeLabels" | "waitForIdle">;
  releaseDbLock(jobName: string, token: string): Promise<unknown>;
  stopBudgetMs?: number;
  cronController?: Pick<CronController, "stop">;
  outboxWorker?: { stop(): void | Promise<void> };
  housekeeping?: HousekeepingLike;
  stopOperationJournalRecovery?: () => Promise<void>;
  stopModerationCleanup?: () => Promise<void>;
  stopChannelLockRecovery?: () => Promise<void>;
  stopIsolatedInspection?: () => void;
  stopAntiRaidSweep?: () => void;
  redis?: { close(): Promise<void> };
  guildInvalidationChannel?: { stop(): Promise<void> };
  adminAlert: AdminAlert;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
}

function createShutdownController({
  lifecycle, logger, env, client, mongoose, httpServer, activeLocks, ingress,
  releaseDbLock, stopBudgetMs = STOP_BUDGET_MS, cronController, outboxWorker, housekeeping, stopOperationJournalRecovery, stopModerationCleanup, stopChannelLockRecovery, stopIsolatedInspection, stopAntiRaidSweep, redis, guildInvalidationChannel, adminAlert,
  errorMessage, errorDetail
}: CreateShutdownControllerDeps): ShutdownController {
  async function stopWithDeadline(component: string, stop: () => unknown): Promise<StopOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<StopStatus>(resolve => {
      timer = setTimeout(() => resolve("timed-out"), stopBudgetMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    const stopped = Promise.resolve()
      .then(stop)
      .then((): StopStatus => "stopped", (err: unknown): StopStatus => {
        logger("WARN", "SHUTDOWN", `Oprirea ${component} a esuat`, errorMessage(err));
        return "failed";
      });
    const status = await Promise.race([stopped, deadline]);
    if (timer) clearTimeout(timer);
    if (status === "timed-out") {
      logger("ERROR", "SHUTDOWN", `Oprirea ${component} nu a terminat in ${stopBudgetMs}ms; inchiderea continua fara ea`);
    }
    return { component, status };
  }

  function stopAll(stoppers: ReadonlyArray<readonly [string, (() => unknown) | undefined]>): Promise<StopOutcome[]> {
    return Promise.all(
      stoppers
        .filter((entry): entry is readonly [string, () => unknown] => typeof entry[1] === "function")
        .map(([component, stop]) => stopWithDeadline(component, stop))
    );
  }

  async function drainIngress(): Promise<void> {
    if (!ingress) {
      if (env.SHUTDOWN_DRAIN_MS > 0) {
        logger("INFO", "SHUTDOWN", `Drain ${env.SHUTDOWN_DRAIN_MS}ms pentru comenzi in zbor`);
        await new Promise(resolve => setTimeout(resolve, env.SHUTDOWN_DRAIN_MS));
      }
      return;
    }
    const pending = ingress.activeCount();
    if (pending === 0) return;
    logger("INFO", "SHUTDOWN", `Drain pentru ${pending} operatii gateway in zbor, cel mult ${env.SHUTDOWN_DRAIN_MS}ms`);
    const idle = await ingress.waitForIdle(env.SHUTDOWN_DRAIN_MS);
    if (idle) return;
    logger("ERROR", "SHUTDOWN", "Drain expirat cu operatii gateway active; inchidere fortata a dependintelor", {
      active: ingress.activeCount(),
      operations: ingress.activeLabels()
    });
  }

  async function shutdown(signal: ShutdownSignal, exitCode = 0): Promise<void> {
    if (lifecycle.isShuttingDown) return;
    lifecycle.isShuttingDown = true;
    logger("INFO", "SHUTDOWN", `Semnal primit: ${signal}, inchidere...`);

    const outcomes = await stopAll([
      ["cron", cronController ? () => cronController.stop() : undefined],
      ["outbox", outboxWorker ? () => outboxWorker.stop() : undefined],
      ["housekeeping", housekeeping ? () => housekeeping.stop() : undefined],
      ["operation-journal-recovery", stopOperationJournalRecovery],
      ["moderation-cleanup", stopModerationCleanup],
      ["channel-lock-recovery", stopChannelLockRecovery],
      ["isolated-inspection", stopIsolatedInspection],
      ["anti-raid-sweep", stopAntiRaidSweep]
    ]);
    const unstopped = outcomes.filter(outcome => outcome.status !== "stopped");

    if (unstopped.length === 0) {
      for (const [jobName, token] of activeLocks.entries()) {
        try { await releaseDbLock(jobName, token); }
        catch (err) { logger("WARN", "SHUTDOWN", `Eroare la eliberare lock ${jobName}`, errorMessage(err)); }
      }
    } else if (activeLocks.size > 0) {
      logger("WARN", "SHUTDOWN", "Lock-urile raman pana la expirarea TTL, fiindca nu toate componentele au confirmat oprirea", {
        locks: [...activeLocks.keys()],
        unstopped
      });
    }

    await drainIngress();

    await stopWithDeadline("discord-client", () => client.destroy());
    await stopAll([
      ["guild-invalidation-channel", guildInvalidationChannel ? () => guildInvalidationChannel.stop() : undefined],
      ["redis", redis ? () => redis.close() : undefined]
    ]);
    await stopWithDeadline("mongo", () => mongoose.connection.close());

    const HTTP_CLOSE_BUDGET_MS = 3000;
    await new Promise<void>(resolve => {
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; resolve(); } };
      const watchdog = setTimeout(() => {
        logger("WARN", "SHUTDOWN", `httpServer.close() nu a terminat in ${HTTP_CLOSE_BUDGET_MS}ms, fortez exit`);
        finish();
      }, HTTP_CLOSE_BUDGET_MS);
      watchdog.unref();
      try {
        httpServer.close((err?: Error) => {
          clearTimeout(watchdog);
          if (err) logger("WARN", "SHUTDOWN", "Eroare close server HTTP", errorMessage(err));
          finish();
        });
      } catch (err) {
        clearTimeout(watchdog);
        logger("WARN", "SHUTDOWN", "Eroare la apelul httpServer.close()", errorMessage(err));
        finish();
      }
    });

    logger("INFO", "SHUTDOWN", "Inchidere completa.");
    setTimeout(() => process.exit(exitCode), 500).unref();
  }

  function handleFatalProcessError(kind: "uncaughtException" | "unhandledRejection", reason: unknown): void {
    const detail = errorDetail(reason);
    logger("ERROR", "PROCESS", kind, detail);

    const ALERT_BUDGET_MS = 2000;
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const budgetPromise = new Promise<void>(resolve => {
      budgetTimer = setTimeout(resolve, ALERT_BUDGET_MS);
      if (typeof budgetTimer.unref === "function") budgetTimer.unref();
    });
    const alertWithBudget = Promise.race([
      adminAlert(`process:${kind}`, kind, detail).catch(() => null),
      budgetPromise
    ]).finally(() => {
      if (budgetTimer) clearTimeout(budgetTimer);
    });
    alertWithBudget.finally(() => { shutdown(kind, 1); });

    setTimeout(() => process.exit(1), 10_000).unref();
  }

  function registerProcessHandlers(): void {
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("uncaughtException", (err) => handleFatalProcessError("uncaughtException", err));
    process.on("unhandledRejection", (reason) => handleFatalProcessError("unhandledRejection", reason));
  }

  return { shutdown, handleFatalProcessError, registerProcessHandlers };
}

export { createShutdownController };
export type { CreateShutdownControllerDeps, ShutdownController };
