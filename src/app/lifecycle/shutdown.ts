import type { ActiveLocks, CronController, LifecycleState, RuntimeEnv } from "../../types";

type ShutdownLogger = (level: "INFO" | "WARN" | "ERROR", context: string, message: string, meta?: unknown) => void;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;

type ShutdownSignal = NodeJS.Signals | "uncaughtException" | "unhandledRejection" | string;

interface DiscordClientLike {
  destroy(): void;
}

interface MongooseLike {
  connection: {
    close(): Promise<void>;
  };
}

interface HttpServerLike {
  close(): unknown;
}

interface HousekeepingLike {
  stop(): void;
}

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
  releaseDbLock(jobName: string, token: string): Promise<unknown>;
  cronController: Pick<CronController, "stop">;
  housekeeping: HousekeepingLike;
  adminAlert: AdminAlert;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
}

function createShutdownController({
  lifecycle, logger, env, client, mongoose, httpServer, activeLocks,
  releaseDbLock, cronController, housekeeping, adminAlert,
  errorMessage, errorDetail
}: CreateShutdownControllerDeps): ShutdownController {
  async function shutdown(signal: ShutdownSignal, exitCode = 0): Promise<void> {
    if (lifecycle.isShuttingDown) return;
    lifecycle.isShuttingDown = true;
    logger("INFO", "SHUTDOWN", `Semnal primit: ${signal}, inchidere...`);

    cronController.stop();
    housekeeping.stop();

    for (const [jobName, token] of activeLocks.entries()) {
      try { await releaseDbLock(jobName, token); }
      catch (err) { logger("WARN", "SHUTDOWN", `Eroare la eliberare lock ${jobName}`, errorMessage(err)); }
    }

    if (env.SHUTDOWN_DRAIN_MS > 0) {
      logger("INFO", "SHUTDOWN", `Drain ${env.SHUTDOWN_DRAIN_MS}ms pentru comenzi in zbor`);
      await new Promise(resolve => setTimeout(resolve, env.SHUTDOWN_DRAIN_MS));
    }

    try { client.destroy(); } catch (err) { logger("WARN", "SHUTDOWN", "Eroare destroy client", errorMessage(err)); }
    try { await mongoose.connection.close(); } catch (err) { logger("WARN", "SHUTDOWN", "Eroare inchidere mongo", errorMessage(err)); }
    try { httpServer.close(); } catch { /* ignore */ }

    logger("INFO", "SHUTDOWN", "Inchidere completa.");
    setTimeout(() => process.exit(exitCode), 500).unref();
  }

  function handleFatalProcessError(kind: "uncaughtException" | "unhandledRejection", reason: unknown): void {
    const detail = errorDetail(reason);
    logger("ERROR", "PROCESS", kind, detail);
    // Race the alert against a short timeout so a slow/offline webhook can't
    // delay shutdown. Either way we always run the shutdown sequence; we just
    // don't block it on the alert promise resolving first.
    const ALERT_BUDGET_MS = 2000;
    const alertWithBudget = Promise.race([
      adminAlert(`process:${kind}`, kind, detail).catch(() => null),
      new Promise(resolve => setTimeout(resolve, ALERT_BUDGET_MS))
    ]);
    alertWithBudget.finally(() => { shutdown(kind, 1); });
    // Hard safety net: if shutdown itself hangs (a stuck drain, a stuck mongo
    // close), force-exit after 10s. Unref'd so a clean shutdown can still let
    // the process exit naturally before this fires.
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
