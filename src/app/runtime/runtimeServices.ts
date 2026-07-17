import type { AppRuntimeDeps, RuntimeServices } from "../appRuntimeContracts.js";

import ________infra_redis_redisMetrics from "../../infra/redis/redisMetrics.js";
const { attachRedisMetrics } = ________infra_redis_redisMetrics;
import { attachGuildSettingsEventMetrics } from "../../infra/mongo/guildSettingsEvents.js";

function createRuntimeServices(deps: AppRuntimeDeps): RuntimeServices {
  const { Client, GatewayIntentBits, loadConfig, createMetrics, createRateLimiter, scrapers, mongo } = deps;
  const { env, setAdminAlertDiscordClient } = mongo;
  const { config, games } = loadConfig();
  const metrics = createMetrics();
  scrapers.attachMetrics(metrics);
  attachRedisMetrics(metrics);
  attachGuildSettingsEventMetrics(metrics);
  const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ] });
  setAdminAlertDiscordClient(client);
  const lifecycle = { isShuttingDown: false };
  const rateLimiter = createRateLimiter(env, metrics);
  return { client, metrics, lifecycle, rateLimiter, config, games };
}

export { createRuntimeServices };

