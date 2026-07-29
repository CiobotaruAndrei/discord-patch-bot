"use strict";

import { createMetricRecorders } from "./health/metricRecorders.js";
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
import { createReputationEngine } from "../features/command-security/reputationEngine.js";
import { createThreatEngineMonitor } from "../features/command-security/threatEngineMonitor.js";
import { createPermissionDelegationRuntime } from "../features/command-security/permissionDelegationRuntime.js";
import { createModerationLifecycleRuntime } from "../features/moderation/moderationLifecycleRuntime.js";
import { createServerEventLogRuntime } from "../features/command-security/serverEventLogRuntime.js";
import { observeConfirmedBotAction } from "../features/command-security/botObservationRepository.js";
import { createModerationCleanupTask } from "./scheduler/moderationCleanupTask.js";
import { createChannelLockRecoveryTask } from "./scheduler/channelLockRecoveryTask.js";
import { createChannelLockRecoveryRuntime } from "../features/command-security/channelLockRecoveryRuntime.js";
import { setLockedChannelPermissionState } from "../features/guild-config/guildConfigRepository.js";
import { roleRunsSchedulers } from "../shared/botRole.js";
import { loadYaraRuleset } from "../features/command-security/yaraRuleset.js";
import { createNewAccountAlertDelivery, reconcileStuckNewAccountSends } from "../features/command-security/newAccountAlertDedup.js";

function assembleAppRuntime(deps: AppRuntimeDeps, services: RuntimeServices, schedulers: Schedulers | null): AppRuntime {
  const { createHttpServer, registerDiscordEvents, registerMongoEvents, createShutdownController, errorMessage, errorDetail, mongoose, crypto, mongo } = deps;
  const { logger, env, getGuildCacheSize, activeLocks, releaseDbLock, requestContext, adminAlert } = mongo;

  const { client, metrics, lifecycle, rateLimiter } = services;
  const recorders = createMetricRecorders(metrics);
  const threatEngineMonitor = createThreatEngineMonitor({ metrics: recorders.threatEngine, logger });
  const reputationScan = createReputationEngine({
    env,
    httpReq: deps.scrapers.httpReq,
    logger,
    onDetails: threatEngineMonitor.onDetails,
    onFailure: threatEngineMonitor.onFailure
  }) ?? undefined;
  const yaraRuleset = loadYaraRuleset(env.YARA_RULES_PATH, logger);
  metrics.yaraRulesLoaded = yaraRuleset.loaded ? yaraRuleset.ruleCount : 0;
  metrics.yaraEngineAvailable = yaraRuleset.available ? 1 : 0;
  const newAccountDelivery = mongo.NewAccountAlertDeliveryModel
    ? createNewAccountAlertDelivery(mongo.NewAccountAlertDeliveryModel, () => crypto.randomBytes(16).toString("hex"))
    : null;
  const newAccountAlertModel = mongo.NewAccountAlertDeliveryModel;
  if (newAccountAlertModel) {
    void reconcileStuckNewAccountSends(newAccountAlertModel).then(closed => {
      if (closed > 0) {
        logger("WARN", "NEW_ACCOUNT_ALERT", "Alerte de cont nou ramase in starea de trimitere au fost inchise la pornire ca sent-unconfirmed; NU au fost retrimise", { closed });
      }
    });
  }
  metrics.threatReputationEngineConfigured = reputationScan ? 1 : 0;
  const securityRuntime = mongo.GuildModel && mongo.GuildAuditLogModel
    ? createSecurityRuntime({
      getGuildSettings: mongo.getGuildSettings ?? (async () => null),
      client,
      GuildModel: mongo.GuildModel,
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      httpReq: deps.scrapers.httpReq,
      reputationScan,
      claimNewAccountAlert: newAccountDelivery?.claim,
      logger,
      metrics: recorders.security
    })
    : undefined;
  const permissionDelegationRuntime = mongo.GuildAuditLogModel && mongo.GuildModel
    ? createPermissionDelegationRuntime({
      GuildModel: mongo.GuildModel,
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      adminAlert,
      metrics: recorders.permissionDelegation
    })
    : undefined;
  const moderationLifecycleRuntime = mongo.GuildModel
    ? createModerationLifecycleRuntime(mongo.GuildModel, logger)
    : undefined;
  const observationModel = mongo.GuildModel;
  const serverEventLogRuntime = mongo.GuildAuditLogModel
    ? createServerEventLogRuntime({
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      logger,
      observeBotAction: observationModel
        ? (guildId, actorId, auditEntryId, kind, at) => observeConfirmedBotAction(observationModel, adminAlert, guildId, actorId, auditEntryId, kind, at)
        : undefined
    })
    : undefined;
  const moderationCleanup = schedulers && moderationLifecycleRuntime
    ? createModerationCleanupTask({
      cleanupExpired: async () => {
        await moderationLifecycleRuntime.cleanupExpired();
        await moderationLifecycleRuntime.reconcileClient(client);
      },
      metrics, logger, adminAlert, errorMessage, errorDetail
    })
    : null;

  const lockRecoveryModel = mongo.ChannelLockRecoveryModel;
  const lockRecoveryGuildModel = mongo.GuildModel;
  const channelLockRecovery = schedulers && lockRecoveryModel && lockRecoveryGuildModel
    ? createChannelLockRecoveryTask({
      runRecoveryCycle: () => createChannelLockRecoveryRuntime({
        RecoveryModel: lockRecoveryModel,
        fetchChannel: async (_guildId, channelId) => (await Promise.resolve(client.channels?.fetch(channelId))) ?? null,
        persistState: (guildId, channelId, previous, locked) =>
          setLockedChannelPermissionState(lockRecoveryGuildModel, guildId, channelId, previous, locked),
        logger
      }).runRecoveryCycle(),
      metrics, logger, adminAlert, errorMessage, errorDetail
    })
    : null;

  const httpServer = createHttpServer({
    mongoose, crypto, env, client, metrics, logger, commands: deps.commands,
    getGuildCacheSize, scrapers: deps.scrapers, activeLocks, rateLimiter,
    cronController: schedulers?.cronController ?? null
  });

  registerDiscordEvents({
    client, logger, commands: deps.commands, metrics, env, adminAlert, requestContext, games: services.games, crypto,
    errorMessage, errorDetail,
    startHousekeeping: schedulers?.housekeeping.start,
    scheduleNextCron: schedulers?.cronController.scheduleNextCron,
    startOutboxWorker: schedulers?.outboxEnabled === true ? schedulers.outboxWorker.start : undefined,
    role: deps.role,
    securityRuntime,
    permissionDelegationRuntime,
    moderationLifecycleRuntime,
    serverEventLogRuntime
  });
  registerMongoEvents({ mongoose, logger, errorMessage });

  const guildInvalidationChannel = createGuildSettingsInvalidationChannel({ redis: deps.redis, logger, bus: mongo.guildSettingsBus });

  const shutdownController = createShutdownController({
    lifecycle, logger, env, client, mongoose, httpServer, activeLocks,
    releaseDbLock, cronController: schedulers?.cronController, outboxWorker: schedulers?.outboxWorker, housekeeping: schedulers?.housekeeping, adminAlert,
    redis: deps.redis, guildInvalidationChannel, stopOperationJournalRecovery: deps.stopOperationJournalRecovery,
    stopModerationCleanup: moderationCleanup ? moderationCleanup.stop : undefined,
    stopChannelLockRecovery: channelLockRecovery ? channelLockRecovery.stop : undefined,
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
    moderationCleanup?.start();
    channelLockRecovery?.start();
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

function createWebRuntime(deps: Omit<AppRuntimeDeps, "role">): AppRuntime {
  const webDeps: AppRuntimeDeps = { ...deps, role: "web" };
  const services = createRuntimeServices(webDeps);
  return assembleAppRuntime(webDeps, services, null);
}

function createWorkerRuntime(deps: Omit<AppRuntimeDeps, "role">): AppRuntime {
  const workerDeps: AppRuntimeDeps = { ...deps, role: "worker" };
  const services = createRuntimeServices(workerDeps);
  return assembleAppRuntime(workerDeps, services, createSchedulers(workerDeps, services));
}

function createAppRuntime(deps: AppRuntimeDeps): AppRuntime {
  const role = deps.role ?? "all";
  if (role === "web") return createWebRuntime(deps);
  if (role === "worker") return createWorkerRuntime(deps);
  const services = createRuntimeServices(deps);
  const schedulers = roleRunsSchedulers(role) ? createSchedulers(deps, services) : null;
  return assembleAppRuntime(deps, services, schedulers);
}

export { createAppRuntime, createWebRuntime, createWorkerRuntime, createRuntimeServices, createSchedulers, connectMongoWithRetry, hydrateStartupCaches, createBootSequence };

