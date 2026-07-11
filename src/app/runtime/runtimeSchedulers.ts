import type { AppRuntimeDeps, RuntimeServices, Schedulers } from "../appRuntime";

function createSchedulers(deps: AppRuntimeDeps, services: RuntimeServices): Schedulers {
  const { mongoose, performance, crypto, createCronController, createOutboxWorker, errorMessage, errorDetail, commands, mongo } = deps;
  const { logger, env, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock, adminAlert, requestContext, getOutboxPaused } = mongo;
  const { client, metrics, lifecycle, config, games } = services;
  const cronController = createCronController({
    mongoose, performance, crypto, logger, env, parseEnvNumber,
    acquireDbLock, renewDbLock, releaseDbLock, commands, adminAlert,
    client, games, config, metrics, lifecycle, errorMessage, errorDetail, requestContext
  });
  const outboxEnabled = env.NOTIFICATION_OUTBOX_ENABLED;
  const outboxDrainLimit = parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_LIMIT", 50, { min: 1, max: 1000 });
  const outboxPerJobBudgetMs = env.DISCORD_SEND_RATE_MAX_WAIT_MS + 2000;
  const outboxWorker = createOutboxWorker({
    mongoose, client, logger, parseEnvNumber, acquireDbLock, releaseDbLock,
    drainOutbox: async drainClient => commands.drainOutbox(drainClient),
    lifecycle, metrics, errorMessage, adminAlert, isPaused: () => getOutboxPaused(),
    drainLimit: outboxDrainLimit, perJobBudgetMs: outboxPerJobBudgetMs
  });
  return { cronController, outboxWorker, outboxEnabled };
}

export { createSchedulers };

