"use strict";

import mongoose from "mongoose";
import crypto from "crypto";
import { performance } from "perf_hooks";
import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "../config/configLoader";
import { createMetrics } from "./health/metrics";
import { createRateLimiter } from "./health/rateLimit";
import { createHousekeeping } from "./scheduler/housekeeping";
import { createCronController } from "./scheduler/cron";
import { createOutboxWorker } from "./scheduler/outboxWorker";
import { createHttpServer } from "./health/httpServer";
import { registerDiscordEvents, registerMongoEvents } from "./lifecycle/events";
import { createShutdownController } from "./lifecycle/shutdown";
import { errorMessage, errorDetail } from "../shared/errors";
import { createAppRuntime } from "./appRuntime";
import redis from "../infra/redis/redisContext";
import type { AppRuntime, AppRuntimeDeps } from "./appRuntime";
import type { BotRole } from "../types";
import type { SourceRegistryApi } from "../sources/sourceRegistry";

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots,
  getOutboxPaused, setAdminAlertDiscordClient
} = require("../infra/mongo/mongoContext").default as typeof import("../infra/mongo/mongoContext")["default"];
import commands from "../features/command-registry/commandRegistry";
import * as scrapers from "../sources/sourceRegistry";

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
