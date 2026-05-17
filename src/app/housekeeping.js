"use strict";

function createHousekeeping({ commands, cleanGuildCache, scrapers, rateLimiter, logger, env, errorMessage }) {
  let timerId = null;

  function start() {
    const tick = () => {
      try { commands.cleanCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanCache eroare", errorMessage(e)); }
      try { cleanGuildCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanGuildCache eroare", errorMessage(e)); }
      try { scrapers.cleanEnrichedCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanEnrichedCache eroare", errorMessage(e)); }
      try { rateLimiter.prune(); } catch (e) { logger("WARN", "HOUSEKEEPING", "pruneRateLimitMap eroare", errorMessage(e)); }
    };
    timerId = setInterval(tick, env.HOUSEKEEPING_INTERVAL_MS);
    if (typeof timerId.unref === "function") timerId.unref();
    logger("INFO", "HOUSEKEEPING", `Pornit interval=${env.HOUSEKEEPING_INTERVAL_MS}ms`);
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return { start, stop };
}

module.exports = { createHousekeeping };
