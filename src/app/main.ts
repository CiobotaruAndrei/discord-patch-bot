// @ts-check
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
const { createHttpServer } = require("./health/httpServer");
const { registerDiscordEvents, registerMongoEvents } = require("./lifecycle/events");
const { createShutdownController } = require("./lifecycle/shutdown");
const { errorMessage, errorDetail } = require("../shared/errors");

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  runMigrations, requestContext
} = require("../infra/mongo/mongoContext");
const commands = require("../features/command-registry/commandRegistry");
const scrapers = require("../sources/sourceRegistry");

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
  rateLimiter,
  cronController
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

// V11: connect-ul direct esua la primul network blip si crash-uia bot-ul, lasand
// platforma (Docker/k8s) sa-l restart-eze. Cu retry exponential bot-ul tolereaza
// fereastra tipica de start a Mongo (~5-15s) fara restart inutil.
const MONGO_CONNECT_MAX_ATTEMPTS = 5;
const MONGO_CONNECT_INITIAL_BACKOFF_MS = 1000;
const MONGO_CONNECT_MAX_BACKOFF_MS = 16000;

async function connectMongoWithRetry(): Promise<void> {
  let backoff = MONGO_CONNECT_INITIAL_BACKOFF_MS;
  for (let attempt = 1; attempt <= MONGO_CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(env.MONGO_URI, { maxPoolSize: env.MONGO_MAX_POOL_SIZE });
      if (attempt > 1) {
        logger("INFO", "BOOT", `Mongo conectat la incercarea ${attempt}/${MONGO_CONNECT_MAX_ATTEMPTS}`);
      }
      return;
    } catch (err) {
      if (attempt === MONGO_CONNECT_MAX_ATTEMPTS) throw err;
      const jitter = Math.round(backoff * (0.5 + Math.random() * 0.5));
      logger(
        "WARN",
        "BOOT",
        `Mongo connect a esuat (incercarea ${attempt}/${MONGO_CONNECT_MAX_ATTEMPTS}), reincerc in ${jitter}ms`,
        errorMessage(err)
      );
      await new Promise(resolve => setTimeout(resolve, jitter));
      backoff = Math.min(backoff * 2, MONGO_CONNECT_MAX_BACKOFF_MS);
    }
  }
}

(async () => {
  try {
    await connectMongoWithRetry();
    const mongoReady = await waitForMongoReady(10000);
    if (!mongoReady) {
      logger("WARN", "BOOT", "Mongo nu a confirmat conexiunea in timp util");
    }

    const migrations = await runMigrations(logger);
    if (migrations.applied.length) {
      logger("INFO", "MIGRATE", `Migrari aplicate: ${migrations.applied.join(", ")}`);
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

export {};
