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
import { createRedisRuntime } from "../infra/redis/redisClient.js";
import { createRedisCache } from "../infra/redis/redisCache.js";
import { createCircuitBreakerStore } from "../sources/updates/circuitBreakerStore.js";
import type { AppRuntime, AppRuntimeDeps } from "./appRuntime.js";
import type { BotRole } from "../types.js";
import type { SourceRegistryApi } from "../sources/sourceRegistry.js";
import * as scrapers from "../sources/sourceRegistry.js";

import mongoContext from "../infra/mongo/mongoContext.js";
const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots,
  getOutboxPaused, setAdminAlertDiscordClient,
  OperationJournalModel, GuildModel, GuildAuditLogModel, GuildConfigBackupModel, GuildYoutubeErrorModel,
  GuildDeadLetterModel, NotificationDeadLetterReplayModel
} = mongoContext;
import commands from "../features/command-registry/commandRegistry.js";
import { createSourceRegistry } from "../sources/sourceRegistryFactory.js";
import {
  createCommandRuntimeDependencies,
  selectCommandMongoDependencies,
  selectCommandSourceDependencies
} from "../features/command-runtime/commandRuntimeDependencies.js";
import { createOperationJournalRuntime } from "../features/admin-records/operationJournalRuntime.js";
import { createScheduledTaskRunner } from "./scheduler/scheduledTaskRunner.js";
import { recordServerAuditEntry } from "../features/admin-records/auditLogRepository.js";

const operationJournal = createOperationJournalRuntime({
  OperationJournalModel, GuildModel, GuildAuditLogModel, GuildConfigBackupModel, GuildYoutubeErrorModel,
  GuildDeadLetterModel, NotificationDeadLetterReplayModel, logger
});
const OPERATION_JOURNAL_RECOVERY_MIN_AGE_MS = 5 * 60 * 1000;
const OPERATION_JOURNAL_RECOVERY_LIMIT = 100;
const OPERATION_JOURNAL_RECOVERY_INTERVAL_MS = 60 * 1000;
const operationJournalRecovery = createScheduledTaskRunner({
  intervalMs: OPERATION_JOURNAL_RECOVERY_INTERVAL_MS,
  task: async () => { await operationJournal.recoverPending({ olderThanMs: OPERATION_JOURNAL_RECOVERY_MIN_AGE_MS, limit: OPERATION_JOURNAL_RECOVERY_LIMIT }); }
});

function buildAppRuntime(role: BotRole): AppRuntime {
  const redisRuntime = createRedisRuntime(env, logger);
  const redisCache = createRedisCache({ runtime: redisRuntime, logger });
  const sourceRegistry = createSourceRegistry({
    env,
    logger,
    getAbortSignal: mongoContext.getAbortSignal,
    getCurrencyConfig: mongoContext.getCurrencyConfig,
    formatPrice: mongoContext.formatPrice,
    runConcurrent: mongoContext.runConcurrent,
    adminAlert,
    SchemaDriftError: mongoContext.SchemaDriftError,
    circuitBreakerStore: createCircuitBreakerStore(mongoContext.CircuitBreakerModel)
  });
  const commandDependencies = createCommandRuntimeDependencies({
    mongo: selectCommandMongoDependencies(mongoContext),
    sources: selectCommandSourceDependencies(sourceRegistry),
    platform: { redis: redisCache }
  });
  const commandRuntime = commands.createCommandRegistry({ runtimeDependencies: commandDependencies });
  return createAppRuntime({
    mongoose, crypto, performance, Client, GatewayIntentBits,
    loadConfig, createMetrics, createRateLimiter, createHousekeeping,
    createCronController, createOutboxWorker, createHttpServer,
    registerDiscordEvents, registerMongoEvents, createShutdownController,
    errorMessage, errorDetail, redis: redisRuntime, role,
    mongo: {
      logger, env, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
      waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
      getGuildSettings: mongoContext.getGuildSettings,
      GuildAuditLogModel,
      recordServerAudit: async entry => recordServerAuditEntry(GuildAuditLogModel, entry.guildId, { action: entry.action, userId: entry.userId || "", details: entry.details || "" }),
      runMigrations, requestContext, loadFetchSnapshot, loadDealsFetchSnapshots,
      getOutboxPaused, setAdminAlertDiscordClient
    },
    commands: commandRuntime, scrapers: sourceRegistry,
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
  const app = role === "web" ? buildWebRuntime() : buildWorkerRuntime();
  app.registerProcessHandlers();
  app.start().catch(() => process.exit(1));
  return app;
}

function startFromEnv(): AppRuntime {
  return startBot(env.BOT_ROLE);
}

export { startBot, startFromEnv, buildAppRuntime, buildWebRuntime, buildWorkerRuntime };
