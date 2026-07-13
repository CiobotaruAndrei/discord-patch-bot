import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
"use strict";

import mongoose from "mongoose";
import crypto from "crypto";
import { performance } from "perf_hooks";
import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "../config/configLoader.js";
import { createMetrics } from "./health/metrics.js";
import { createRateLimiter } from "./health/rateLimit.js";
import { createHousekeeping } from "./scheduler/housekeeping.js";
import { createCronController } from "./scheduler/cron.js";
import { createOutboxWorker } from "./scheduler/outboxWorker.js";
import { createHttpServer } from "./health/httpServer.js";
import { registerDiscordEvents, registerMongoEvents } from "./lifecycle/events.js";
import { createShutdownController } from "./lifecycle/shutdown.js";
import { errorMessage, errorDetail } from "../shared/errors.js";
import { createAppRuntime } from "./appRuntime.js";
import redis from "../infra/redis/redisContext.js";
import type { AppRuntime, AppRuntimeDeps } from "./appRuntime.js";
import type { BotRole } from "../types.js";
import type { SourceRegistryApi } from "../sources/sourceRegistry.js";

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots,
  getOutboxPaused, setAdminAlertDiscordClient
} = require("../infra/mongo/mongoContext").default as typeof import("../infra/mongo/mongoContext.js")["default"];
import commands from "../features/command-registry/commandRegistry.js";
import * as scrapers from "../sources/sourceRegistry.js";

function buildAppRuntime(role: BotRole): AppRuntime {
  return createAppRuntime({
    mongoose, crypto, performance, Client, GatewayIntentBits,
    loadConfig, createMetrics, createRateLimiter, createHousekeeping,
    createCronController, createOutboxWorker, createHttpServer,
    registerDiscordEvents, registerMongoEvents, createShutdownController,
    errorMessage, errorDetail, redis, role,
    mongo: {
      logger, env, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
      waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
      runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots,
      getOutboxPaused, setAdminAlertDiscordClient
    },
    commands, scrapers
  } satisfies AppRuntimeDeps);
}

function startBot(role: BotRole): AppRuntime {
  logger("INFO", "BOOT", `Pornire bot in rol '${role}'`);
  const app = buildAppRuntime(role);
  app.registerProcessHandlers();
  app.start().catch(() => process.exit(1));
  return app;
}

function startFromEnv(): AppRuntime {
  return startBot(env.BOT_ROLE);
}

export { startBot, startFromEnv, buildAppRuntime };
