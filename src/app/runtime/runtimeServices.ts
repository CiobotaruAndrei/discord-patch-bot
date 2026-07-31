import type { AppRuntimeDeps, RuntimeServices } from "../appRuntimeContracts.js";
import { createMetricRecorders } from "../health/metricRecorders.js";
import { intentNamesForRole } from "../../shared/botRole.js";

import ________infra_redis_redisMetrics from "../../infra/redis/redisMetrics.js";
const { attachRedisMetrics } = ________infra_redis_redisMetrics;

import { attachIsolatedInspection, isolatedInspectionStatus } from "../../features/command-security/isolatedInspection.js";

function createRuntimeServices(deps: AppRuntimeDeps): RuntimeServices {
  const { Client, GatewayIntentBits, loadConfig, createMetrics, createRateLimiter, scrapers, mongo } = deps;
  const { env, setAdminAlertDiscordClient, logger } = mongo;
  const { config, games } = loadConfig();
  const metrics = createMetrics();
  scrapers.attachMetrics(metrics);
  attachRedisMetrics(metrics);
  mongo.guildSettingsBus.attachMetrics(metrics);
  const client = new Client({ intents: intentNamesForRole(env.BOT_ROLE).map(name => GatewayIntentBits[name]) });
  setAdminAlertDiscordClient(client);
  const lifecycle = { isShuttingDown: false };
  const recorders = createMetricRecorders(metrics);
  attachIsolatedInspection({ metrics: recorders.inspector, logger });
  logger("INFO", "NATIVE-INSPECTOR", isolatedInspectionStatus().reason);
  const rateLimiter = createRateLimiter(env, recorders.httpServer);
  return { client, metrics, recorders, lifecycle, rateLimiter, config, games };
}

export { createRuntimeServices };

