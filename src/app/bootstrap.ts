"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { Client, GatewayIntentBits } = require("discord.js");
const { loadConfig } = require("../config/configLoader") as typeof import("../config/configLoader");
const { createMetrics } = require("./health/metrics") as typeof import("./health/metrics");
const { createRateLimiter } = require("./health/rateLimit") as typeof import("./health/rateLimit");
const { createHousekeeping } = require("./scheduler/housekeeping") as typeof import("./scheduler/housekeeping");
const { createCronController } = require("./scheduler/cron") as typeof import("./scheduler/cron");
const { createOutboxWorker } = require("./scheduler/outboxWorker") as typeof import("./scheduler/outboxWorker");
const { createHttpServer } = require("./health/httpServer") as typeof import("./health/httpServer");
const { registerDiscordEvents, registerMongoEvents } = require("./lifecycle/events") as typeof import("./lifecycle/events");
const { createShutdownController } = require("./lifecycle/shutdown") as typeof import("./lifecycle/shutdown");
const { errorMessage, errorDetail } = require("../shared/errors") as typeof import("../shared/errors");
const { createAppRuntime } = require("./appRuntime") as typeof import("./appRuntime");
const redis = require("../infra/redis/redisContext") as typeof import("../infra/redis/redisContext");
import type { AppRuntime, AppRuntimeDeps } from "./appRuntime";
import type { BotRole } from "../types";
import type { SourceRegistryApi } from "../sources/sourceRegistry";

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots,
  getOutboxPaused, setAdminAlertDiscordClient
} = require("../infra/mongo/mongoContext") as typeof import("../infra/mongo/mongoContext");
const commands = require("../features/command-registry/commandRegistry") as typeof import("../features/command-registry/commandRegistry");
const scrapers = require("../sources/sourceRegistry") as SourceRegistryApi;

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
