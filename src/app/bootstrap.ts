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
import { redisRuntime as redis } from "./runtimeComposition.js";
import type { AppRuntime, AppRuntimeDeps } from "./appRuntime.js";
import type { BotRole } from "../types.js";
import type { SourceRegistryApi } from "../sources/sourceRegistry.js";

import mongoContext from "../infra/mongo/mongoContext.js";
const {
  logger, env, parseEnvNumber,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize,
  requestContext, getOutboxPaused
} = mongoContext;
import commandRegistryFactories from "../features/command-registry/commandRegistry.js";
import { sourceRegistry as scrapers, commandRuntimeInput, mongoContextBundles } from "./runtimeComposition.js";
import { createOperationJournalRuntime } from "../features/admin-records/operationJournalRuntime.js";
import { createDeferredTransactionRunner } from "../infra/mongo/transactionRunner.js";
import { createScheduledTaskRunner } from "./scheduler/scheduledTaskRunner.js";

const { repositories, locks, migrations, snapshots, administration } = mongoContextBundles;

mongoose.set("updatePipeline", true);

const operationJournal = createOperationJournalRuntime({
  OperationJournalModel: repositories.OperationJournalModel,
  GuildModel: repositories.GuildModel,
  GuildAuditLogModel: repositories.GuildAuditLogModel,
  GuildConfigBackupModel: repositories.GuildConfigBackupModel,
  GuildYoutubeErrorModel: repositories.GuildYoutubeErrorModel,
  GuildDeadLetterModel: repositories.GuildDeadLetterModel,
  NotificationDeadLetterReplayModel: repositories.NotificationDeadLetterReplayModel,
  transactionRunner: createDeferredTransactionRunner(mongoose, logger),
  logger
});
const OPERATION_JOURNAL_RECOVERY_MIN_AGE_MS = 5 * 60 * 1000;
const OPERATION_JOURNAL_RECOVERY_LIMIT = 100;
const OPERATION_JOURNAL_RECOVERY_INTERVAL_MS = 60 * 1000;
const operationJournalRecovery = createScheduledTaskRunner({
  intervalMs: OPERATION_JOURNAL_RECOVERY_INTERVAL_MS,
  task: async () => { await operationJournal.recoverPending({ olderThanMs: OPERATION_JOURNAL_RECOVERY_MIN_AGE_MS, limit: OPERATION_JOURNAL_RECOVERY_LIMIT }); }
});

const commands = commandRegistryFactories.createCommandRegistry(commandRuntimeInput);

function buildAppRuntime(role: BotRole): AppRuntime {
  return createAppRuntime({
    mongoose, crypto, performance, Client, GatewayIntentBits,
    loadConfig, createMetrics, createRateLimiter, createHousekeeping,
    createCronController, createOutboxWorker, createHttpServer,
    registerDiscordEvents, registerMongoEvents, createShutdownController,
    errorMessage, errorDetail, redis, role,
    mongo: {
      logger, env, parseEnvNumber,
      ...locks,
      waitForMongoReady, cleanGuildCache, getGuildCacheSize,
      ...administration,
      runMigrations: migrations.runMigrations,
      requestContext,
      loadFetchSnapshot: snapshots.loadFetchSnapshot,
      loadDealsFetchSnapshots: snapshots.loadDealsFetchSnapshots,
      getOutboxPaused,
      GuildModel: repositories.GuildModel,
      GuildAuditLogModel: repositories.GuildAuditLogModel
    },
    commands, scrapers,
    recoverOperationJournal: () => operationJournal.recoverPending({ olderThanMs: OPERATION_JOURNAL_RECOVERY_MIN_AGE_MS, limit: OPERATION_JOURNAL_RECOVERY_LIMIT }),
    startOperationJournalRecovery: operationJournalRecovery.start,
    stopOperationJournalRecovery: operationJournalRecovery.stop
  } satisfies AppRuntimeDeps);
}

function buildWebRuntime(): AppRuntime {
  return buildAppRuntime("web");
}

function buildWorkerRuntime(): AppRuntime {
  return buildAppRuntime("worker");
}

function startBot(role: BotRole): AppRuntime {
  logger("INFO", "BOOT", `Pornire bot in rol '${role}'`);
  const app = role === "web" ? buildWebRuntime() : role === "worker" ? buildWorkerRuntime() : buildAppRuntime(role);
  app.registerProcessHandlers();
  app.start().catch(() => process.exit(1));
  return app;
}

function startFromEnv(): AppRuntime {
  return startBot(env.BOT_ROLE);
}

export { startBot, startFromEnv, buildAppRuntime, buildWebRuntime, buildWorkerRuntime };
