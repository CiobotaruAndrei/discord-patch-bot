// @ts-check
"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { Client, GatewayIntentBits } = require("discord.js");
const { loadConfig } = require("./configLoader");
const { createMetrics } = require("./metrics");
const { createRateLimiter } = require("./rateLimit");
const { createHousekeeping } = require("./housekeeping");
const { createCronController } = require("./cron");
const { createHttpServer } = require("./httpServer");
const { registerDiscordEvents, registerMongoEvents } = require("./events");
const { createShutdownController } = require("./shutdown");
const { errorMessage, errorDetail } = require("./errors");

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  requestContext
} = require("../data");
const commands = require("../commands");
const scrapers = require("../scrapers");

const { config, games } = loadConfig();
const metrics = createMetrics();
scrapers.attachMetrics(metrics);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});
const lifecycle = { isShuttingDown: false };
const rateLimiter = createRateLimiter(env, metrics);
const housekeeping = createHousekeeping({
  commands,
  cleanGuildCache,
  scrapers,
  rateLimiter,
  logger,
  env,
  errorMessage
});
const cronController = createCronController({
  mongoose,
  performance,
  crypto,
  logger,
  env,
  parseEnvNumber,
  acquireDbLock,
  renewDbLock,
  releaseDbLock,
  commands,
  adminAlert,
  client,
  games,
  config,
  metrics,
  lifecycle,
  errorMessage,
  errorDetail,
  requestContext
});
const httpServer = createHttpServer({
  mongoose,
  crypto,
  env,
  client,
  metrics,
  commands,
  getGuildCacheSize,
  scrapers,
  activeLocks,
  rateLimiter
});

registerDiscordEvents({
  client,
  logger,
  commands,
  env,
  adminAlert,
  requestContext,
  games,
  crypto,
  errorMessage,
  errorDetail,
  startHousekeeping: housekeeping.start,
  scheduleNextCron: cronController.scheduleNextCron
});
registerMongoEvents({ mongoose, logger, errorMessage });

createShutdownController({
  lifecycle,
  logger,
  env,
  client,
  mongoose,
  httpServer,
  activeLocks,
  releaseDbLock,
  cronController,
  housekeeping,
  adminAlert,
  errorMessage,
  errorDetail
}).registerProcessHandlers();

(async () => {
  try {
    await mongoose.connect(env.MONGO_URI, { maxPoolSize: env.MONGO_MAX_POOL_SIZE });
    const mongoReady = await waitForMongoReady(10000);
    if (!mongoReady) {
      logger("WARN", "BOOT", "Mongo nu a confirmat conexiunea in timp util");
    }

    httpServer.listen(env.PORT, () => {
      logger("INFO", "HTTP", `Health/metrics server pornit pe port ${env.PORT}`);
    });

    await client.login(env.DISCORD_TOKEN);
  } catch (err) {
    logger("ERROR", "BOOT", "Eroare la pornire", errorDetail(err));
    adminAlert("boot:fatal", "Botul nu a putut porni", errorMessage(err)).catch(() => null);
    process.exit(1);
  }
})();
