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
  const healthWindow = [];
  let healthSkipScheduled = false;

  function recordHealth(success, durationMs) {
    healthWindow.push({ success, durationMs });
    if (healthWindow.length > env.GLOBAL_HEALTH_WINDOW) healthWindow.shift();
  }

  function shouldSkipForGlobalHealth() {
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

  function getHealthSnapshot() {
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
    if (shouldSkipForGlobalHealth()) {
      metrics.cronSkippedDueToHealth = (metrics.cronSkippedDueToHealth || 0) + 1;
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
    let success = false;
    const cronReqId = `cron-${metrics.cronRuns}-${crypto.randomBytes(3).toString("hex")}`;
    await requestContext.run({ requestId: cronReqId, abortSignal: currentCronAbortController.signal }, async () => {
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
        recordHealth(success, durationMs);
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

  return { scheduleNextCron, runCronCycle, stop, shouldAbortCron, getHealthSnapshot };
}

module.exports = { createCronController };
