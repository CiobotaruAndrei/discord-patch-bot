import type { AppRuntimeDeps, RuntimeServices, Schedulers } from "../appRuntimeContracts.js";

function createSchedulers(deps: AppRuntimeDeps, services: RuntimeServices): Schedulers {
  const { mongoose, performance, crypto, createCronController, createOutboxWorker, createHousekeeping, scrapers, errorMessage, errorDetail, commands, mongo } = deps;
  const { logger, env, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock, adminAlert, requestContext, getOutboxPaused, cleanGuildCache } = mongo;
  const { client, metrics, lifecycle, config, games, rateLimiter } = services;
  const cronController = createCronController({
    mongoose, performance, crypto, logger, env, parseEnvNumber,
    acquireDbLock, renewDbLock, releaseDbLock, commands, adminAlert,
    client, games, config, metrics, lifecycle, errorMessage, errorDetail, requestContext
  });
  const outboxEnabled = env.NOTIFICATION_OUTBOX_ENABLED;
  const outboxDrainLimit = parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_LIMIT", 50, { min: 1, max: 1000 });
  const outboxPerJobBudgetMs = env.DISCORD_SEND_RATE_MAX_WAIT_MS + 2000;
  const outboxWorker = createOutboxWorker({
    mongoose, client, logger, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock,
    drainOutbox: async (drainClient, shouldAbort) => commands.drainOutbox(drainClient, shouldAbort),
    lifecycle, metrics, errorMessage, adminAlert, isPaused: () => getOutboxPaused(),
    drainLimit: outboxDrainLimit, perJobBudgetMs: outboxPerJobBudgetMs
  });
  const housekeeping = createHousekeeping({
    commands, guildConfig: deps.ports.mongo.guildConfig, deals: deps.ports.sources.deals, rateLimiter, logger, env, errorMessage
  });
  return { cronController, outboxWorker, outboxEnabled, housekeeping };
}

export { createSchedulers };

