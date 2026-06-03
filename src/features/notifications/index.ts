"use strict";

import type { Model } from "mongoose";
import type { SeenRepositoryDeps } from "./seenRepository";
import type { UpdateNotificationServiceDeps } from "./updateNotificationService";
import type { DiscountNotificationServiceDeps } from "./discountNotificationService";

const {
  DISCORD_PERMANENT_ERROR_CODES,
  createOutboundChannelResolver,
  isPermanentDiscordError,
  transientErrorMessage
} = require("./outboundChannel");
const { createSeenRepository } = require("./seenRepository");
const { createUpdateNotificationService } = require("./updateNotificationService");
const { createDiscountNotificationService } = require("./discountNotificationService");
const { createOutboxRuntime, applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker } = require("./notificationOutbox");
const { createOutboxDelivery } = require("./outboxDelivery");
const { buildDeadLetterEntry, deadLetterPush } = require("./deadLetter");
const { defaultDiscordSendLimiter } = require("./discordRateLimiter");

const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_BACKOFF_MS = 60_000;
const OUTBOX_DRAIN_LIMIT = Math.min(1000, Math.max(1, Number(process.env.NOTIFICATION_OUTBOX_DRAIN_LIMIT) || 50));

interface OutboxJobShape { _id?: unknown; guildId: string; channelId: string; kind: "update" | "discount"; payload: unknown; attempts: number; deliveries?: number; dedupeKey?: string; }
interface OutboxClient { user: { id: string }; channels: { fetch(channelId: string): Promise<unknown> }; }
const OUTBOX_RECOVERY_VERIFY = process.env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY === "true";
const OUTBOX_RECOVERY_STRICT = process.env.NOTIFICATION_OUTBOX_RECOVERY_STRICT === "true";
const OUTBOX_RECOVERY_HISTORY_LIMIT = Math.min(100, Math.max(5, Number(process.env.NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT) || 25));

type GeneratedUpdateDeps =
  | "resolveOutboundChannel"
  | "claimSeenUpdate"
  | "rollbackSeenUpdate"
  | "disableUpdatesForChannelError"
  | "isPermanentDiscordError"
  | "transientErrorMessage";

type GeneratedDiscountDeps =
  | "resolveOutboundChannel"
  | "claimSeenDiscount"
  | "rollbackSeenDiscount"
  | "disableDiscountsForChannelError"
  | "isPermanentDiscordError"
  | "transientErrorMessage";

type NotificationsRuntimeDeps = SeenRepositoryDeps
  & Omit<UpdateNotificationServiceDeps, GeneratedUpdateDeps>
  & Omit<DiscountNotificationServiceDeps, GeneratedDiscountDeps>
  & {
    canSendEmbeds(channel: unknown, botId: string): boolean;
    saveFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
    NotificationOutboxModel: Model<OutboxJobShape>;
    NotificationOutboxSentModel: Model<{ dedupeKey: string; sentAt?: Date }>;
  };

type NotificationsContext = NotificationsRuntimeDeps & Record<string, unknown>;

function createNotificationRuntime(deps: NotificationsRuntimeDeps) {
  const {
    GuildModel, logger, DEFAULT_CURRENCY, runConcurrent,
    validatePendingDiscountSnapshot, getLatestForAllGames, fetchDeals,
    enrichDealData, dealHash, canSendEmbeds, buildUpdateEmbed,
    buildDealEmbed, setUpdatesCache, getDealsCacheData, setDealsCache,
    saveFetchSnapshot, loadFetchSnapshot, GuildSeenDiscountModel, GuildSeenUpdateModel, NotificationOutboxModel, NotificationOutboxSentModel,
    normalizeCurrencyKey, normalizePendingUpdateArray,
    normalizePendingDiscountArray, toEntries, rotateAfter, mapToObject,
    dealPassesFilters, sleepIfPositive, withMongoRetry, OP_UPDATE_OPTS,
    SEEN_PER_GAME_LIMIT, PENDING_UPDATE_MAX_AGE_MS,
    PENDING_UPDATE_MAX_ATTEMPTS, PENDING_UPDATES_PER_GAME_LIMIT,
    MAX_UPDATES_PER_CYCLE, DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY, DEALS_HISTORY_LIMIT,
    PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE
  } = deps;

  const persistFetchSnapshot = saveFetchSnapshot as ((id: string, payload: unknown) => Promise<void>) | undefined;
  const loadSnapshot = loadFetchSnapshot as ((id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>) | undefined;

  const outboxEnabled = process.env.NOTIFICATION_OUTBOX_ENABLED === "true";
  const outbox = createOutboxRuntime({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry, logger });
  const enqueueOutbox = outboxEnabled ? outbox.enqueueOutbox : undefined;

  const resolveOutboundChannel = createOutboundChannelResolver({ logger, canSendEmbeds, enqueueOutbox });

  const outboxDelivery = createOutboxDelivery({
    canSendEmbeds,
    isPermanentDiscordError,
    acquireSendSlot: () => defaultDiscordSendLimiter.acquire(),
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: OUTBOX_RECOVERY_VERIFY,
    recoveryStrict: OUTBOX_RECOVERY_STRICT,
    historyLimit: OUTBOX_RECOVERY_HISTORY_LIMIT
  });

  async function recordOutboxDeadLetter(job: OutboxJobShape, reason: string): Promise<void> {
    const push = deadLetterPush([buildDeadLetterEntry({
      kind: job.kind, itemId: String(job._id ?? ""), title: "", reason, attempts: (job.attempts || 0) + 1
    })]);
    if (push) await GuildModel.updateOne({ _id: job.guildId }, { $push: push }).catch(() => undefined);
  }

  async function drainOutbox(client: OutboxClient) {
    const result = await outbox.drainOutbox({
      deliver: (job: OutboxJobShape) => outboxDelivery.deliver(client, job),
      recordDeadLetter: recordOutboxDeadLetter,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      backoffMs: OUTBOX_BACKOFF_MS,
      limit: OUTBOX_DRAIN_LIMIT
    });
    const guildCounter = GuildModel as unknown as { countDocuments(filter: Record<string, unknown>): Promise<number> };
    const recoveryVerifyEnabledGuilds = await guildCounter.countDocuments({ outboxRecoveryVerify: true }).catch(() => undefined);
    return typeof recoveryVerifyEnabledGuilds === "number" ? { ...result, recoveryVerifyEnabledGuilds } : result;
  }

  const seenRepository = createSeenRepository({
    GuildModel, GuildSeenDiscountModel, GuildSeenUpdateModel, withMongoRetry, SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS
  });
  const {
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, disableUpdatesForChannelError,
    claimSeenDiscount, rollbackSeenDiscount, seedSeenDiscounts, loadSeenDiscountHashes, disableDiscountsForChannelError,
    setSeenHashVersion
  } = seenRepository;

  const updateService = createUpdateNotificationService({
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, setSeenHashVersion, disableUpdatesForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, setUpdatesCache, persistFetchSnapshot, loadFetchSnapshot: loadSnapshot, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });

  const discountService = createDiscountNotificationService({
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenDiscount, rollbackSeenDiscount, loadSeenDiscountHashes, seedSeenDiscounts, setSeenHashVersion, disableDiscountsForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingDiscountArray, validatePendingDiscountSnapshot,
    normalizeCurrencyKey, dealPassesFilters, dealHash,
    fetchDeals, getDealsCacheData, setDealsCache, persistFetchSnapshot, loadFetchSnapshot: loadSnapshot, enrichDealData, buildDealEmbed,
    sleepIfPositive,
    DEFAULT_CURRENCY, DEALS_HISTORY_LIMIT,
    PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });

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
    checkForDiscounts: discountService.checkForDiscounts,
    drainOutbox
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
