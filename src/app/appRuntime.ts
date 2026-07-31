"use strict";

import type { ActiveLocks, BotRole, LifecycleState } from "../types.js";
import type { BotMetrics } from "./health/metricsTypes.js";
import type { RateLimiter } from "./health/rateLimitTypes.js";
import type { CronController } from "./scheduler/schedulerTypes.js";
import type { BotConfig, ConfigLoadResult, GameConfig } from "../config/configTypes.js";
import type { RuntimeEnv } from "../config/runtimeEnvTypes.js";
import type { CommandCacheSizes } from "../features/command-cache/commandCacheTypes.js";
import type { DealInfo, FetchResult } from "../sources/sourceTypes.js";
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
import { createThreatEngineMonitor } from "../features/command-security/threatEngineMonitor.js";
import { createModerationLifecycleRuntime } from "../features/moderation/moderationLifecycleRuntime.js";
import { createModerationStore } from "../features/moderation/moderationStore.js";
import { journaledSliceCopy } from "../features/admin-records/journaledSliceCopy.js";
import { roleRunsInteractions, roleRunsSchedulers } from "../shared/botRole.js";
import { createGatewayFeatureRuntimes, createInactiveGatewayFeatureRuntimes } from "./runtime/gatewayFeatureRuntimes.js";
import { createIdleSchedulerFeatureTasks, createSchedulerFeatureTasks } from "./runtime/schedulerFeatureTasks.js";
import type { GatewayFeatureRuntimes } from "./runtime/gatewayFeatureRuntimes.js";
import type { SchedulerFeatureTasks } from "./runtime/schedulerFeatureTasks.js";

type ModerationLifecycle = ReturnType<typeof createModerationLifecycleRuntime>;

type RuntimeComposition = {
  readonly gateway: GatewayFeatureRuntimes;
  readonly tasks: SchedulerFeatureTasks;
  readonly schedulers: Schedulers | null;
  readonly moderationLifecycleRuntime?: ModerationLifecycle;
};

function assembleAppRuntime(deps: AppRuntimeDeps, services: RuntimeServices, composition: RuntimeComposition): AppRuntime {
  const { createHttpServer, registerDiscordEvents, registerMongoEvents, createShutdownController, errorMessage, errorDetail, mongoose, crypto, mongo } = deps;
  const { logger, env, getGuildCacheSize, activeLocks, releaseDbLock, requestContext, adminAlert } = mongo;
  const { gateway, tasks, schedulers, moderationLifecycleRuntime } = composition;

  const { client, metrics, lifecycle, rateLimiter } = services;

  const httpServer = createHttpServer({
    mongoose, crypto, env, client, metrics, recorders: services.recorders.httpServer, logger, commands: deps.commands,
    getGuildCacheSize, scrapers: deps.scrapers, activeLocks, rateLimiter,
    cronController: schedulers?.cronController ?? null
  });

  registerDiscordEvents({
    client, logger, commands: deps.commands, metrics: services.recorders, env, adminAlert, requestContext, games: services.games, crypto,
    errorMessage, errorDetail,
    startHousekeeping: schedulers?.housekeeping.start,
    scheduleNextCron: schedulers?.cronController.scheduleNextCron,
    startOutboxWorker: schedulers?.outboxEnabled === true ? schedulers.outboxWorker.start : undefined,
    role: deps.role,
    securityRuntime: gateway.securityRuntime,
    permissionDelegationRuntime: gateway.permissionDelegationRuntime,
    moderationLifecycleRuntime,
    serverEventLogRuntime: gateway.serverEventLogRuntime
  });
  registerMongoEvents({ mongoose, logger, errorMessage });

  const guildInvalidationChannel = createGuildSettingsInvalidationChannel({ redis: deps.redis, logger, bus: mongo.guildSettingsBus });

  const shutdownController = createShutdownController({
    lifecycle, logger, env, client, mongoose, httpServer, activeLocks,
    releaseDbLock, cronController: schedulers?.cronController, outboxWorker: schedulers?.outboxWorker, housekeeping: schedulers?.housekeeping, adminAlert,
    redis: deps.redis, guildInvalidationChannel, stopOperationJournalRecovery: deps.stopOperationJournalRecovery,
    stopModerationCleanup: tasks.moderationCleanup ? tasks.moderationCleanup.stop : undefined,
    stopChannelLockRecovery: tasks.channelLockRecovery ? tasks.channelLockRecovery.stop : undefined,
    errorMessage, errorDetail
  });

  const bootStart = createBootSequence(deps, {
    client,
    httpServer,
    guildInvalidationChannel,
    recoverOperationJournal: deps.recoverOperationJournal,
    startOperationJournalRecovery: deps.startOperationJournalRecovery
  });
  async function start(): Promise<void> {
    await bootStart();
    await moderationLifecycleRuntime?.reconcileClient(client);
    tasks.moderationCleanup?.start();
    tasks.channelLockRecovery?.start();
  }

  return {
    start,
    stop: (signal: string, exitCode?: number) => shutdownController.shutdown(signal, exitCode),
    registerProcessHandlers: () => shutdownController.registerProcessHandlers(),
    cronController: schedulers?.cronController ?? null,
    outboxWorker: schedulers?.outboxWorker ?? null,
    httpServer,
    metrics
  };
}

function composeGatewayFeatures(deps: AppRuntimeDeps, services: RuntimeServices): GatewayFeatureRuntimes {
  const recorders = services.recorders;
  const threatEngineMonitor = createThreatEngineMonitor({ metrics: recorders.threatEngine, logger: deps.mongo.logger });
  return createGatewayFeatureRuntimes({
    mongo: deps.mongo,
    client: services.client,
    metrics: services.metrics,
    recorders,
    scrapers: deps.scrapers,
    crypto: deps.crypto,
    onThreatDetails: threatEngineMonitor.onDetails,
    onThreatFailure: threatEngineMonitor.onFailure
  });
}

function composeModerationLifecycle(deps: AppRuntimeDeps): ModerationLifecycle | undefined {
  const guildModel = deps.mongo.GuildModel;
  if (!guildModel) return undefined;
  const moderationModel = deps.mongo.GuildModerationModel;
  const store = moderationModel
    ? createModerationStore(
      guildModel,
      moderationModel,
      guildId => {
        deps.mongo.logger("INFO", "MODERATION_STORE", "Starea de moderare a fost mutata in colectia dedicata", { guildId });
      },
      journaledSliceCopy({
        OperationJournalModel: deps.mongo.OperationJournalModel,
        domain: "moderation",
        dedicatedModel: moderationModel,
        logger: deps.mongo.logger
      })
    )
    : guildModel;
  return createModerationLifecycleRuntime(store, deps.mongo.logger);
}

function composeSchedulerTasks(
  deps: AppRuntimeDeps,
  services: RuntimeServices,
  moderationLifecycleRuntime: ModerationLifecycle | undefined
): SchedulerFeatureTasks {
  return createSchedulerFeatureTasks({
    mongo: deps.mongo,
    client: services.client,
    recorders: services.recorders,
    moderationLifecycleRuntime,
    errorMessage: deps.errorMessage,
    errorDetail: deps.errorDetail
  });
}

function createWebRuntime(deps: Omit<AppRuntimeDeps, "role">): AppRuntime {
  const webDeps: AppRuntimeDeps = { ...deps, role: "web" };
  const services = createRuntimeServices(webDeps);
  return assembleAppRuntime(webDeps, services, {
    gateway: composeGatewayFeatures(webDeps, services),
    tasks: createIdleSchedulerFeatureTasks(),
    schedulers: null,
    moderationLifecycleRuntime: composeModerationLifecycle(webDeps)
  });
}

function createWorkerRuntime(deps: Omit<AppRuntimeDeps, "role">): AppRuntime {
  const workerDeps: AppRuntimeDeps = { ...deps, role: "worker" };
  const services = createRuntimeServices(workerDeps);
  const moderationLifecycleRuntime = composeModerationLifecycle(workerDeps);
  return assembleAppRuntime(workerDeps, services, {
    gateway: createInactiveGatewayFeatureRuntimes(services.recorders.threatSurface),
    tasks: composeSchedulerTasks(workerDeps, services, moderationLifecycleRuntime),
    schedulers: createSchedulers(workerDeps, services),
    moderationLifecycleRuntime
  });
}

function createAppRuntime(deps: AppRuntimeDeps): AppRuntime {
  const role = deps.role ?? "all";
  if (role === "web") return createWebRuntime(deps);
  if (role === "worker") return createWorkerRuntime(deps);
  const services = createRuntimeServices(deps);
  const runsInteractions = roleRunsInteractions(role);
  const runsSchedulers = roleRunsSchedulers(role);
  const moderationLifecycleRuntime = composeModerationLifecycle(deps);
  return assembleAppRuntime(deps, services, {
    gateway: runsInteractions ? composeGatewayFeatures(deps, services) : createInactiveGatewayFeatureRuntimes(services.recorders.threatSurface),
    tasks: runsSchedulers ? composeSchedulerTasks(deps, services, moderationLifecycleRuntime) : createIdleSchedulerFeatureTasks(),
    schedulers: runsSchedulers ? createSchedulers(deps, services) : null,
    moderationLifecycleRuntime
  });
}

export { createAppRuntime, createWebRuntime, createWorkerRuntime, createRuntimeServices, createSchedulers, connectMongoWithRetry, hydrateStartupCaches, createBootSequence };
