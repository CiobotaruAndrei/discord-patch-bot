import type { AppRuntimeDeps, RuntimeServices } from "../appRuntimeContracts.js";
import { createMetricRecorders } from "../health/metricRecorders.js";
import { intentNamesForRole } from "../../shared/botRole.js";

import ________infra_redis_redisMetrics from "../../infra/redis/redisMetrics.js";
const { attachRedisMetrics } = ________infra_redis_redisMetrics;

function createRuntimeServices(deps: AppRuntimeDeps): RuntimeServices {
  const { Client, GatewayIntentBits, loadConfig, createMetrics, createRateLimiter, scrapers, mongo } = deps;
  const { env, setAdminAlertDiscordClient } = mongo;
  const { config, games } = loadConfig();
  const metrics = createMetrics();
  scrapers.attachMetrics(metrics);
  attachRedisMetrics(metrics);
  mongo.guildSettingsBus.attachMetrics(metrics);
  const client = new Client({ intents: intentNamesForRole(env.BOT_ROLE).map(name => GatewayIntentBits[name]) });
  setAdminAlertDiscordClient(client);
  const lifecycle = { isShuttingDown: false };
  const recorders = createMetricRecorders(metrics);
  const rateLimiter = createRateLimiter(env, recorders.httpServer);
  return { client, metrics, recorders, lifecycle, rateLimiter, config, games };
}

export { createRuntimeServices };

