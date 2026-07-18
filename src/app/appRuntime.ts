"use strict";

import type {
  ActiveLocks,
  BotConfig,
  BotMetrics,
  BotRole,
  CommandCacheSizes,
  ConfigLoadResult,
  DealInfo,
  FetchResult,
  CronController,
  GameConfig,
  LifecycleState,
  RateLimiter,
  RuntimeEnv
} from "../types.js";
import type { CreateCronControllerDeps } from "./scheduler/cron.js";
import type { CreateHousekeepingDeps, HousekeepingController } from "./scheduler/housekeeping.js";
import type { CreateOutboxWorkerDeps, OutboxWorker } from "./scheduler/outboxWorker.js";
import type { CreateHttpServerDeps } from "./health/httpServer.js";
import type { RegisterDiscordEventsDeps, RegisterMongoEventsDeps } from "./lifecycle/events.js";
import type { LifecycleDiscordChannel, LifecycleDiscordInteraction, LifecycleEventClient } from "./lifecycle/lifecycleContracts.js";
import type { CreateShutdownControllerDeps, ShutdownController } from "./lifecycle/shutdown.js";
import type { OutboxDiscordClient } from "../features/notifications/outboundChannel.js";
import type { RedisRuntime } from "../infra/redis/redisClient.js";

import type {
  CommandRuntime,
  ScraperRuntime,
  HttpServerLike,
  DiscordClientLike,
  AppRuntimeDeps,
  RuntimeServices,
  Schedulers,
  AppRuntime,
  MongoContextLike
} from "./appRuntimeContracts.js";
export type {
  CommandRuntime,
  ScraperRuntime,
  HttpServerLike,
  DiscordClientLike,
  AppRuntimeDeps,
  RuntimeServices,
  Schedulers,
  AppRuntime
} from "./appRuntimeContracts.js";

import { createRuntimeServices } from "./runtime/runtimeServices.js";
import { createSchedulers } from "./runtime/runtimeSchedulers.js";
import { createBootSequence, connectMongoWithRetry, hydrateStartupCaches } from "./runtime/bootSequence.js";
import { createGuildSettingsInvalidationChannel } from "../infra/redis/guildSettingsInvalidationChannel.js";
import { createSecurityRuntime } from "../features/command-security/securityRuntime.js";
import { createBotObservationAggregator } from "../features/command-security/botObservationAggregator.js";
import { createBotObservationRepository } from "../features/command-security/botObservationRepository.js";
import type { ThreatResource } from "../features/command-security/threatInspection.js";

const MAX_THREAT_DOWNLOAD_BYTES = 8 * 1024 * 1024;

async function fetchThreatResource(resource: ThreatResource): Promise<Uint8Array> {
  const url = new URL(resource.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("schema de URL nesuportata pentru scanarea atasamentului");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`descarcarea atasamentului a esuat cu HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_THREAT_DOWNLOAD_BYTES) throw new Error("atasamentul depaseste limita de bytes pentru scanare");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_THREAT_DOWNLOAD_BYTES) throw new Error("atasamentul depaseste limita de bytes pentru scanare");
  return bytes;
}

function createAppRuntime(deps: AppRuntimeDeps): AppRuntime {
  const { createHttpServer, registerDiscordEvents, registerMongoEvents, createShutdownController, errorMessage, errorDetail, mongoose, crypto, mongo } = deps;
  const { logger, env, getGuildCacheSize, activeLocks, releaseDbLock, requestContext, adminAlert } = mongo;

  const services = createRuntimeServices(deps);
  const { client, metrics, lifecycle, rateLimiter, housekeeping } = services;
  const schedulers = createSchedulers(deps, services);
  const { cronController, outboxWorker, outboxEnabled } = schedulers;
  const observationAggregator = createBotObservationAggregator();
  const observationRepository = mongo.GuildAuditLogModel ? createBotObservationRepository(mongo.GuildAuditLogModel) : undefined;
  const securityRuntime = createSecurityRuntime({
    getGuildSettings: mongo.getGuildSettings ?? (async () => null),
    client,
    fetchThreatResource,
    externalThreatScanner: deps.externalThreatScanner,
    observationAggregator,
    observationRepository
  });

  const httpServer = createHttpServer({
    mongoose, crypto, env, client, metrics, logger, commands: deps.commands,
    getGuildCacheSize, scrapers: deps.scrapers, activeLocks, rateLimiter, cronController
  });

  registerDiscordEvents({
    client, logger, commands: deps.commands, metrics, env, adminAlert, requestContext, games: services.games, crypto,
    errorMessage, errorDetail,
    startHousekeeping: housekeeping.start,
    scheduleNextCron: cronController.scheduleNextCron,
    startOutboxWorker: outboxEnabled ? outboxWorker.start : undefined,
    role: deps.role,
    securityRuntime,
    serverAudit: mongo.recordServerAudit
  });
  registerMongoEvents({ mongoose, logger, errorMessage });

  const guildInvalidationChannel = createGuildSettingsInvalidationChannel({ redis: deps.redis, logger });

  const shutdownController = createShutdownController({
    lifecycle, logger, env, client, mongoose, httpServer, activeLocks,
    releaseDbLock, cronController, outboxWorker, housekeeping, adminAlert,
    redis: deps.redis, guildInvalidationChannel, stopOperationJournalRecovery: deps.stopOperationJournalRecovery, errorMessage, errorDetail
  });

  const start = createBootSequence(deps, {
    client,
    httpServer,
    guildInvalidationChannel,
    recoverOperationJournal: deps.recoverOperationJournal,
    startOperationJournalRecovery: deps.startOperationJournalRecovery
  });

  return {
    start,
    stop: (signal: string, exitCode?: number) => shutdownController.shutdown(signal, exitCode),
    registerProcessHandlers: () => shutdownController.registerProcessHandlers(),
    cronController,
    outboxWorker,
    httpServer,
    metrics
  };
}

export { createAppRuntime, createRuntimeServices, createSchedulers, connectMongoWithRetry, hydrateStartupCaches, createBootSequence };

