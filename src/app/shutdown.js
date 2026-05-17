"use strict";

function createShutdownController({
  lifecycle, logger, env, client, mongoose, httpServer, activeLocks,
  releaseDbLock, cronController, housekeeping, adminAlert,
  errorMessage, errorDetail
}) {
  async function shutdown(signal, exitCode = 0) {
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
      await new Promise(r => setTimeout(r, env.SHUTDOWN_DRAIN_MS));
    }

    try { client.destroy(); } catch (err) { logger("WARN", "SHUTDOWN", "Eroare destroy client", errorMessage(err)); }
    try { await mongoose.connection.close(); } catch (err) { logger("WARN", "SHUTDOWN", "Eroare inchidere mongo", errorMessage(err)); }
    try { httpServer.close(); } catch { /* ignore */ }

    logger("INFO", "SHUTDOWN", "Inchidere completa.");
    setTimeout(() => process.exit(exitCode), 500).unref();
  }

  function handleFatalProcessError(kind, reason) {
    const detail = errorDetail(reason);
    logger("ERROR", "PROCESS", kind, detail);
    adminAlert(`process:${kind}`, kind, detail)
      .catch(() => null)
      .finally(() => shutdown(kind, 1));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  function registerProcessHandlers() {
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("uncaughtException", (err) => handleFatalProcessError("uncaughtException", err));
    process.on("unhandledRejection", (reason) => handleFatalProcessError("unhandledRejection", reason));
  }

  return { shutdown, handleFatalProcessError, registerProcessHandlers };
}

module.exports = { createShutdownController };
