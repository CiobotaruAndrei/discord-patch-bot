"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { Client, GatewayIntentBits } = require("discord.js");
const { loadConfig } = require("../config/configLoader");
const { createMetrics } = require("./health/metrics");
const { createRateLimiter } = require("./health/rateLimit");
const { createHousekeeping } = require("./scheduler/housekeeping");
const { createCronController } = require("./scheduler/cron");
const { createOutboxWorker } = require("./scheduler/outboxWorker");
const { createHttpServer } = require("./health/httpServer");
const { registerDiscordEvents, registerMongoEvents } = require("./lifecycle/events");
const { createShutdownController } = require("./lifecycle/shutdown");
const { errorMessage, errorDetail } = require("../shared/errors");
const { createAppRuntime } = require("./appRuntime");

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots
} = require("../infra/mongo/mongoContext");
const commands = require("../features/command-registry/commandRegistry");
const scrapers = require("../sources/sourceRegistry");

const app = createAppRuntime({
  mongoose, crypto, performance, Client, GatewayIntentBits,
  loadConfig, createMetrics, createRateLimiter, createHousekeeping,
  createCronController, createOutboxWorker, createHttpServer,
  registerDiscordEvents, registerMongoEvents, createShutdownController,
  errorMessage, errorDetail,
  mongo: {
    logger, env, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
    waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
    runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots
  },
  commands, scrapers
});

app.registerProcessHandlers();
app.start().catch(() => process.exit(1));

export {};
