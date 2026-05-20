import type { RuntimeEnv } from "../../types";
import type { RateLimiter } from "../health/rateLimit";

type HousekeepingLogger = (level: "INFO" | "WARN", context: string, message: string, meta?: unknown) => void;
type ErrorFormatter = (err: unknown) => string;

interface HousekeepingCommands {
  cleanCache(): unknown;
}

interface HousekeepingScrapers {
  cleanEnrichedCache(): unknown;
}

interface HousekeepingController {
  start(): void;
  stop(): void;
}

interface CreateHousekeepingDeps {
  commands: HousekeepingCommands;
  cleanGuildCache(): unknown;
  scrapers: HousekeepingScrapers;
  rateLimiter: Pick<RateLimiter, "prune">;
  logger: HousekeepingLogger;
  env: Pick<RuntimeEnv, "HOUSEKEEPING_INTERVAL_MS">;
  errorMessage: ErrorFormatter;
}

function createHousekeeping({
  commands,
  cleanGuildCache,
  scrapers,
  rateLimiter,
  logger,
  env,
  errorMessage
}: CreateHousekeepingDeps): HousekeepingController {
  let timerId: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    if (timerId) return;
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

  function stop(): void {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return { start, stop };
}

export { createHousekeeping };
export type { HousekeepingController };
