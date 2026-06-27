"use strict";

import type { Model } from "mongoose";
import type { PriceValue, RuntimeEnv } from "../../types";
import type { SeenRepositoryDeps } from "./seenRepository";
import type { UpdateNotificationServiceDeps } from "./updateNotificationService";
import type { DiscountNotificationServiceDeps } from "./discountNotificationService";
import type { OutboxRuntimeDeps } from "./notificationOutbox";
import type { HistoryRepositoryDeps } from "./historyRepository";
import type { DeadLetterReplayRepositoryDeps } from "./deadLetterReplayRepository";
import type { OutboxDiscordClient } from "./outboundChannel";
import type { SourceRegistryApi } from "../../sources/sourceRegistry";
import type { GuildSeenYoutubeDoc } from "../../infra/mongo/modelTypes";

const {
  DISCORD_PERMANENT_ERROR_CODES,
  createOutboundChannelResolver,
  isPermanentDiscordError,
  transientErrorMessage
} = require("./outboundChannel") as typeof import("./outboundChannel");
const { createSeenRepository } = require("./seenRepository") as typeof import("./seenRepository");
const { createHistoryRepository } = require("./historyRepository") as typeof import("./historyRepository");
const { createUpdateNotificationService } = require("./updateNotificationService") as typeof import("./updateNotificationService");
const { createDiscountNotificationService } = require("./discountNotificationService") as typeof import("./discountNotificationService");
const { createOutboxRuntime, applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker } = require("./notificationOutbox") as typeof import("./notificationOutbox");
const { createOutboxDelivery } = require("./outboxDelivery") as typeof import("./outboxDelivery");
const { buildDeadLetterEntry, deadLetterPush, deadLetterTitleFromPayload } = require("./deadLetter") as typeof import("./deadLetter");
const { createDeadLetterReplayRepository } = require("./deadLetterReplayRepository") as typeof import("./deadLetterReplayRepository");
const { createDefaultDiscordSendLimiter } = require("./discordRateLimiter") as typeof import("./discordRateLimiter");
const { createPriceAlertService } = require("./priceAlertService") as typeof import("./priceAlertService");
const { createYouTubeSource } = require("../youtube/youtubeSource") as typeof import("../youtube/youtubeSource");
const { createYouTubeRepository } = require("../youtube/youtubeRepository") as typeof import("../youtube/youtubeRepository");
const { createYouTubeNotificationService } = require("../youtube/youtubeNotificationService") as typeof import("../youtube/youtubeNotificationService");

const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_BACKOFF_MS = 60_000;

interface OutboxJobShape { _id?: unknown; guildId: string; channelId: string; kind: "update" | "discount" | "youtube"; payload: unknown; attempts?: number; deliveries?: number; dedupeKey?: string; recoveryVerify?: boolean; }

type GeneratedUpdateDeps =
  | "resolveOutboundChannel"
  | "claimSeenUpdate"
  | "rollbackSeenUpdate"
  | "seedSeenUpdates"
  | "setSeenHashVersion"
  | "disableUpdatesForChannelError"
  | "isPermanentDiscordError"
  | "transientErrorMessage";

type GeneratedDiscountDeps =
  | "resolveOutboundChannel"
  | "claimSeenDiscount"
  | "rollbackSeenDiscount"
  | "loadSeenDiscountHashes"
  | "seedSeenDiscounts"
  | "setSeenHashVersion"
  | "disableDiscountsForChannelError"
  | "rollbackTriggeredAlert"
  | "isPermanentDiscordError"
  | "transientErrorMessage"
  | "processGuildPriceAlerts";

type NotificationsRuntimeDeps = SeenRepositoryDeps
  & Omit<UpdateNotificationServiceDeps, GeneratedUpdateDeps>
  & Omit<DiscountNotificationServiceDeps, GeneratedDiscountDeps>
  & {
    env: RuntimeEnv;
    GuildModel: { countDocuments(filter: Record<string, unknown>): Promise<number> };
    canSendEmbeds(channel: unknown, botId: string): boolean;
    formatPrice(value: PriceValue, currencyCode?: string | null): string;
    saveFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
    NotificationOutboxModel: OutboxRuntimeDeps["NotificationOutboxModel"];
    NotificationOutboxSentModel: OutboxRuntimeDeps["NotificationOutboxSentModel"];
    NotificationHistoryModel: HistoryRepositoryDeps["NotificationHistoryModel"];
    NotificationDeadLetterReplayModel: DeadLetterReplayRepositoryDeps["NotificationDeadLetterReplayModel"];
    GuildSeenYoutubeModel: Model<GuildSeenYoutubeDoc>;
    httpReq: SourceRegistryApi["httpReq"];
    safeCheerioLoad: SourceRegistryApi["safeCheerioLoad"];
    FETCH_CONCURRENCY: number;
    PRICE_ALERT_REARM_ABSENT_CYCLES: number;
    invalidateGuildCache(guildId: string): void;
    adminAlert?: (kind: string, title: string, body: unknown, guildId?: string) => Promise<unknown>;
  };

type NotificationsContext = NotificationsRuntimeDeps & Record<string, unknown>;

function createOutboxServices(deps: NotificationsRuntimeDeps) {
  const {
    NOTIFICATION_OUTBOX_ENABLED: outboxEnabled,
    NOTIFICATION_OUTBOX_DRAIN_LIMIT: OUTBOX_DRAIN_LIMIT,
    NOTIFICATION_OUTBOX_MAX_AGE_MS: OUTBOX_MAX_AGE_MS,
    NOTIFICATION_OUTBOX_RECOVERY_VERIFY: OUTBOX_RECOVERY_VERIFY,
    NOTIFICATION_OUTBOX_RECOVERY_STRICT: OUTBOX_RECOVERY_STRICT,
    NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: OUTBOX_RECOVERY_HISTORY_LIMIT
  } = deps.env;
  const {
    GuildModel, logger, canSendEmbeds, withMongoRetry,
    NotificationOutboxModel, NotificationOutboxSentModel, NotificationHistoryModel, NotificationDeadLetterReplayModel
  } = deps;

  const outbox = createOutboxRuntime({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry, logger });
  const enqueueOutbox = outboxEnabled ? outbox.enqueueOutbox : undefined;
  const deadLetterReplayRepository = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel, withMongoRetry, logger });
  const historyRepository = createHistoryRepository({ NotificationHistoryModel, withMongoRetry, logger });

  const sendLimiter = createDefaultDiscordSendLimiter(deps.env);
  const resolveOutboundChannel = createOutboundChannelResolver({ logger, canSendEmbeds, acquireSendSlot: () => sendLimiter.acquire(), enqueueOutbox, recordSentHistory: historyRepository.recordSent });

  const outboxDelivery = createOutboxDelivery({
    canSendEmbeds,
    isPermanentDiscordError,
    acquireSendSlot: () => sendLimiter.acquire(),
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: OUTBOX_RECOVERY_VERIFY,
    recoveryStrict: OUTBOX_RECOVERY_STRICT,
    historyLimit: OUTBOX_RECOVERY_HISTORY_LIMIT
  });

  async function recordOutboxDeadLetter(job: OutboxJobShape, reason: string): Promise<void> {
    const push = deadLetterPush([buildDeadLetterEntry({
      kind: job.kind, itemId: String(job._id ?? ""), title: deadLetterTitleFromPayload(job.payload), channelId: job.channelId, dedupeKey: job.dedupeKey, reason, attempts: (job.attempts || 0) + 1
    })]);
    if (push) await GuildModel.updateOne({ _id: job.guildId }, { $push: push }).catch((err: unknown) => logger("WARN", "OUTBOX", `Nu am putut scrie intrarea de audit dead-letter pentru guild ${job.guildId} (poate diverge de payload-ul de replay)`, err));
    await deadLetterReplayRepository.recordPayload({
      guildId: job.guildId, kind: job.kind, channelId: job.channelId, payload: job.payload,
      dedupeKey: job.dedupeKey, recoveryVerify: job.recoveryVerify, reason, itemId: String(job._id ?? "")
    });
  }

  async function drainOutbox(client: OutboxDiscordClient) {
    const result = await outbox.drainOutbox({
      deliver: (job: OutboxJobShape) => outboxDelivery.deliver(client, job),
      isStillSubscribed: (job: OutboxJobShape) => GuildModel.countDocuments(
        job.kind === "discount"
          ? { _id: job.guildId, discountsSubscribed: true, discountChannelId: job.channelId }
          : job.kind === "youtube"
            ? {
                _id: job.guildId,
                youtubeNotificationsEnabled: true,
                $or: [
                  { youtubeNotificationChannelId: job.channelId },
                  { "youtubeChannelRoutes.discordChannelIds": job.channelId }
                ]
              }
            : { _id: job.guildId, subscribed: true, notificationChannelId: job.channelId }
      ).then(count => count > 0).catch(() => true),
      recordDeadLetter: recordOutboxDeadLetter,
      recordSentHistory: historyRepository.recordSent,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      backoffMs: OUTBOX_BACKOFF_MS,
      limit: OUTBOX_DRAIN_LIMIT,
      maxAgeMs: OUTBOX_MAX_AGE_MS
    });
    const recoveryVerifyEnabledGuilds = await GuildModel.countDocuments({ outboxRecoveryVerify: true }).catch(() => undefined);
    return typeof recoveryVerifyEnabledGuilds === "number" ? { ...result, recoveryVerifyEnabledGuilds } : result;
  }

  return { enqueueOutbox, resolveOutboundChannel, drainOutbox, deadLetterReplayRepository, historyRepository };
}

function createSeenServices(deps: NotificationsRuntimeDeps) {
  const { GuildModel, GuildSeenDiscountModel, GuildSeenUpdateModel, withMongoRetry, SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS } = deps;
  return createSeenRepository({
    GuildModel, GuildSeenDiscountModel, GuildSeenUpdateModel, withMongoRetry,
    SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS, adminAlert: deps.adminAlert
  });
}

function createNotificationDispatchServices(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: ReturnType<typeof createOutboundChannelResolver>,
  seenRepository: ReturnType<typeof createSeenRepository>
) {
  const {
    GuildModel, logger, DEFAULT_CURRENCY, runConcurrent,
    validatePendingDiscountSnapshot, validateUpdateFetchSnapshot, getLatestForAllGames, fetchDeals,
    enrichDealData, dealHash, buildUpdateEmbed,
    buildDealEmbed, setUpdatesCache, getDealsCacheData, setDealsCache,
    saveFetchSnapshot, loadFetchSnapshot,
    normalizeCurrencyKey, normalizePendingUpdateArray,
    normalizePendingDiscountArray, toEntries, rotateAfter, mapToObject,
    dealPassesFilters, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS, PENDING_UPDATES_PER_GAME_LIMIT,
    MAX_UPDATES_PER_CYCLE, DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY, DEALS_HISTORY_LIMIT,
    PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES, PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE,
    PRICE_ALERT_REARM_ABSENT_CYCLES
  } = deps;
  const {
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, disableUpdatesForChannelError,
    claimSeenDiscount, rollbackSeenDiscount, seedSeenDiscounts, loadSeenDiscountHashes, disableDiscountsForChannelError,
    setSeenHashVersion
  } = seenRepository;
  const persistFetchSnapshot = saveFetchSnapshot as ((id: string, payload: unknown) => Promise<void>) | undefined;
  const loadSnapshot = loadFetchSnapshot as ((id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>) | undefined;

  const updateService = createUpdateNotificationService({
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, setSeenHashVersion, disableUpdatesForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, validateUpdateFetchSnapshot, setUpdatesCache, persistFetchSnapshot, loadFetchSnapshot: loadSnapshot, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });

  const priceAlertService = createPriceAlertService({
    GuildModel,
    logger,
    resolveOutboundChannel,
    disableDiscountsForChannelError,
    rollbackTriggeredAlert: seenRepository.rollbackTriggeredAlert,
    formatPrice: deps.formatPrice,
    sleepIfPositive,
    DISCORD_SEND_DELAY_MS,
    rearmAbsentCycles: PRICE_ALERT_REARM_ABSENT_CYCLES
  });

  const discountService = createDiscountNotificationService({
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenDiscount, rollbackSeenDiscount, loadSeenDiscountHashes, seedSeenDiscounts, setSeenHashVersion, disableDiscountsForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingDiscountArray, validatePendingDiscountSnapshot,
    normalizeCurrencyKey, dealPassesFilters, dealHash,
    fetchDeals, getDealsCacheData, setDealsCache, persistFetchSnapshot, loadFetchSnapshot: loadSnapshot, enrichDealData, buildDealEmbed,
    sleepIfPositive, processGuildPriceAlerts: priceAlertService.processGuildPriceAlerts,
    DEFAULT_CURRENCY, DEALS_HISTORY_LIMIT,
    PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });

  const youtubeSource = createYouTubeSource({
    httpReq: deps.httpReq,
    safeCheerioLoad: deps.safeCheerioLoad
  });
  const youtubeRepository = createYouTubeRepository({
    GuildModel: deps.GuildModel,
    GuildSeenYoutubeModel: deps.GuildSeenYoutubeModel,
    withMongoRetry: deps.withMongoRetry,
    invalidateGuildCache: deps.invalidateGuildCache,
    adminAlert: async (kind, title, body, guildId) => {
      await deps.adminAlert?.(kind, title, body, guildId);
    },
    logger
  });
  const youtubeService = createYouTubeNotificationService({
    GuildModel: deps.GuildModel,
    logger,
    runConcurrent,
    fetchYouTubeFeed: youtubeSource.fetchYouTubeFeed,
    fetchYouTubeVideoMetadata: youtubeSource.fetchYouTubeVideoMetadata,
    videoPassesYouTubeFilters: youtubeSource.videoPassesYouTubeFilters,
    claimVideo: youtubeRepository.claimVideo,
    rollbackVideo: youtubeRepository.rollbackVideo,
    recordChannelSuccess: youtubeRepository.recordChannelSuccess,
    recordChannelError: youtubeRepository.recordChannelError,
    disableNotificationsForChannelError: youtubeRepository.disableNotificationsForChannelError,
    removeRouteForChannelError: youtubeRepository.removeRouteForChannelError,
    resolveOutboundChannel,
    sleepIfPositive,
    transientErrorMessage,
    GUILD_PROCESS_CONCURRENCY,
    FETCH_CONCURRENCY: deps.FETCH_CONCURRENCY
  });

  return {
    updateService,
    discountService,
    priceAlertService,
    youtubeSource,
    youtubeRepository,
    youtubeService
  };
}

function createNotificationRuntime(deps: NotificationsRuntimeDeps) {
  const { enqueueOutbox, resolveOutboundChannel, drainOutbox, deadLetterReplayRepository, historyRepository } = createOutboxServices(deps);
  const seenRepository = createSeenServices(deps);
  const {
    updateService,
    discountService,
    priceAlertService,
    youtubeSource,
    youtubeRepository,
    youtubeService
  } = createNotificationDispatchServices(deps, resolveOutboundChannel, seenRepository);
  const {
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, disableUpdatesForChannelError,
    claimSeenDiscount, rollbackSeenDiscount, seedSeenDiscounts, disableDiscountsForChannelError
  } = seenRepository;

  return {
    DISCORD_PERMANENT_ERROR_CODES,
    isPermanentDiscordError,
    transientErrorMessage,
    resolveOutboundChannel,
    claimSeenUpdate,
    rollbackSeenUpdate,
    seedSeenUpdates,
    disableUpdatesForChannelError,
    processGuildUpdates: updateService.processGuildUpdates,
    buildOptimizedGameList: updateService.buildOptimizedGameList,
    checkForUpdates: updateService.checkForUpdates,
    claimSeenDiscount,
    rollbackSeenDiscount,
    seedSeenDiscounts,
    disableDiscountsForChannelError,
    processGuildDiscounts: discountService.processGuildDiscounts,
    processGuildPriceAlerts: priceAlertService.processGuildPriceAlerts,
    checkForDiscounts: discountService.checkForDiscounts,
    resolveYouTubeChannel: youtubeSource.resolveYouTubeChannel,
    fetchYouTubeFeed: youtubeSource.fetchYouTubeFeed,
    fetchYouTubeVideoMetadata: youtubeSource.fetchYouTubeVideoMetadata,
    videoPassesYouTubeFilters: youtubeSource.videoPassesYouTubeFilters,
    seedSeenVideos: youtubeRepository.seedSeenVideos,
    removeSeenChannel: youtubeRepository.removeSeenChannel,
    clearYouTubeErrors: youtubeRepository.clearErrors,
    checkForYouTube: youtubeService.checkForYouTube,
    showYouTubeVideos: youtubeService.showYouTubeVideos,
    prepareManualYouTubeVideos: youtubeService.prepareManualVideos,
    deliverManualYouTubeVideos: youtubeService.deliverManualVideos,
    drainOutbox,
    enqueueOutbox,
    listReplayableDeadLetters: deadLetterReplayRepository.listForGuild,
    deleteReplayedDeadLetters: deadLetterReplayRepository.deleteReplayed,
    deleteAllReplayPayloads: deadLetterReplayRepository.deleteAllForGuild,
    recordSentHistory: historyRepository.recordSent,
    getNotificationHistory: historyRepository.getRecent
  };
}

type NotificationsInstaller = ((target: NotificationsContext) => void) & {
  createNotificationRuntime: typeof createNotificationRuntime;
};

const installNotifications = ((target: NotificationsContext): void => {
  Object.assign(target, createNotificationRuntime(target));
}) as NotificationsInstaller;

installNotifications.createNotificationRuntime = createNotificationRuntime;

export = installNotifications;
