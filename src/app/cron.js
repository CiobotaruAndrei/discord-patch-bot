"use strict";

function createCronController({
  mongoose, performance, crypto, logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, commands, adminAlert,
  client, games, config, metrics, lifecycle, errorMessage, errorDetail,
  requestContext
}) {
  const allowedIntervals = new Set([
    10 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000
  ]);
  const configIntervalMs = Number.isFinite(config.checkIntervalMinutes) && config.checkIntervalMinutes > 0
    ? Math.round(config.checkIntervalMinutes * 60 * 1000)
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

  let cronTimerId = null;
  let heartbeatTimerId = null;
  let currentCronAbortController = null;
  let currentCronToken = null;

  function shouldAbortCron() {
    return lifecycle.isShuttingDown || (currentCronAbortController?.signal.aborted ?? false);
  }

  function stopHeartbeat() {
    if (heartbeatTimerId) {
      clearTimeout(heartbeatTimerId);
      heartbeatTimerId = null;
    }
  }

  function startHeartbeat(lockToken) {
    stopHeartbeat();
    const tick = async () => {
      if (lifecycle.isShuttingDown || currentCronToken !== lockToken) return;
      try {
        const renewed = await renewDbLock("cron_main", lockToken, lockTtlMs);
        if (!renewed) {
          logger("WARN", "CRON_HEARTBEAT", "Lock-ul cron nu a putut fi reinnoit, anulez ciclul");
          if (currentCronAbortController) currentCronAbortController.abort();
          return;
        }
      } catch (err) {
        logger("WARN", "CRON_HEARTBEAT", "Eroare la reinnoirea lock-ului", errorMessage(err));
      }
      if (!lifecycle.isShuttingDown && currentCronToken === lockToken) {
        heartbeatTimerId = setTimeout(tick, heartbeatIntervalMs);
        if (typeof heartbeatTimerId.unref === "function") heartbeatTimerId.unref();
      }
    };
    heartbeatTimerId = setTimeout(tick, heartbeatIntervalMs);
    if (typeof heartbeatTimerId.unref === "function") heartbeatTimerId.unref();
  }

  function scheduleNextCron() {
    if (lifecycle.isShuttingDown) return;
    if (cronTimerId) clearTimeout(cronTimerId);
    cronTimerId = setTimeout(runCronCycle, cronIntervalMs);
    if (typeof cronTimerId.unref === "function") cronTimerId.unref();
  }

  async function runCronCycle() {
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

    const lockToken = await acquireDbLock("cron_main", lockTtlMs);
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
    const cronReqId = `cron-${metrics.cronRuns}-${crypto.randomBytes(3).toString("hex")}`;
    await requestContext.run({ requestId: cronReqId }, async () => {
      try {
        logger("INFO", "CRON", `Pornire ciclu cron #${metrics.cronRuns}`);
        await Promise.all([
          commands.checkForUpdates(client, games, shouldAbortCron),
          commands.checkForDiscounts(client, shouldAbortCron)
        ]);
        if (currentCronAbortController?.signal.aborted) {
          metrics.cronAborted++;
          logger("WARN", "CRON", "Ciclu abandonat (shutdown sau abort)");
        } else {
          const ms = Math.round(performance.now() - cycleStart);
          logger("INFO", "CRON", `Ciclu cron #${metrics.cronRuns} finalizat in ${ms}ms`);
        }
      } catch (err) {
        metrics.cronErrors++;
        logger("ERROR", "CRON", `Eroare in ciclul cron #${metrics.cronRuns}`, errorDetail(err));
        adminAlert("cron:fatal", `Eroare cron ciclu #${metrics.cronRuns}`, errorMessage(err)).catch(() => null);
      } finally {
        stopHeartbeat();
        await releaseDbLock("cron_main", lockToken).catch(() => null);
        currentCronToken = null;
        currentCronAbortController = null;
        if (!lifecycle.isShuttingDown) scheduleNextCron();
      }
    });
  }

  function stop() {
    if (currentCronAbortController) currentCronAbortController.abort();
    if (cronTimerId) clearTimeout(cronTimerId);
    stopHeartbeat();
  }

  return { scheduleNextCron, runCronCycle, stop, shouldAbortCron };
}

module.exports = { createCronController };
