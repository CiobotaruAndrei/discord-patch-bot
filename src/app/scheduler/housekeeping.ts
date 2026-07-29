import type { GuildConfigStore } from "../../infra/mongo/mongoPorts.js";
import type { DealsSourcePort } from "../../sources/sourceRegistryPorts.js";
import type { RuntimeEnv } from "../../types.js";
import type { RateLimiter } from "../health/rateLimit.js";
import { createScheduledTaskRunner } from "./scheduledTaskRunner.js";

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
  stop(): Promise<void>;
}

interface CreateHousekeepingDeps {
  commands: HousekeepingCommands;
  guildConfig: Pick<GuildConfigStore, "sweepExpired">;
  deals: Pick<DealsSourcePort, "sweepEnrichedCache">;
  rateLimiter: Pick<RateLimiter, "prune">;
  logger: HousekeepingLogger;
  env: Pick<RuntimeEnv, "HOUSEKEEPING_INTERVAL_MS">;
  errorMessage: ErrorFormatter;
}

function createHousekeeping({
  commands,
  guildConfig,
  deals,
  rateLimiter,
  logger,
  env,
  errorMessage
}: CreateHousekeepingDeps): HousekeepingController {
  const runner = createScheduledTaskRunner({
    intervalMs: env.HOUSEKEEPING_INTERVAL_MS,
    task: () => {
      try { commands.cleanCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanCache eroare", errorMessage(e)); }
      try { guildConfig.sweepExpired(); } catch (e) { logger("WARN", "HOUSEKEEPING", "sweepExpired eroare", errorMessage(e)); }
      try { deals.sweepEnrichedCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "sweepEnrichedCache eroare", errorMessage(e)); }
      try { rateLimiter.prune(); } catch (e) { logger("WARN", "HOUSEKEEPING", "pruneRateLimitMap eroare", errorMessage(e)); }
    }
  });

  function start(): void {
    runner.start();
    logger("INFO", "HOUSEKEEPING", `Pornit interval=${env.HOUSEKEEPING_INTERVAL_MS}ms`);
  }

  async function stop(): Promise<void> {
    await runner.stop();
  }

  return { start, stop };
}

export { createHousekeeping };
export type { CreateHousekeepingDeps, HousekeepingController };
