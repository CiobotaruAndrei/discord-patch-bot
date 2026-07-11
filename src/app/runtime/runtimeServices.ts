import type { AppRuntimeDeps, RuntimeServices } from "../appRuntime";

const { attachRedisMetrics } = require("../../infra/redis/redisMetrics") as typeof import("../../infra/redis/redisMetrics");

function createRuntimeServices(deps: AppRuntimeDeps): RuntimeServices {
  const { Client, GatewayIntentBits, loadConfig, createMetrics, createRateLimiter, createHousekeeping, scrapers, commands, errorMessage, mongo } = deps;
  const { logger, env, cleanGuildCache, setAdminAlertDiscordClient } = mongo;
  const { config, games } = loadConfig();
  const metrics = createMetrics();
  scrapers.attachMetrics(metrics);
  attachRedisMetrics(metrics);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  setAdminAlertDiscordClient(client);
  const lifecycle = { isShuttingDown: false };
  const rateLimiter = createRateLimiter(env, metrics);
  const housekeeping = createHousekeeping({
    commands, cleanGuildCache, scrapers, rateLimiter, logger, env, errorMessage
  });
  return { client, metrics, lifecycle, rateLimiter, housekeeping, config, games };
}

export { createRuntimeServices };

