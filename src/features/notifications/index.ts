"use strict";

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

type NotificationsContext = SeenRepositoryDeps
  & Omit<UpdateNotificationServiceDeps, GeneratedUpdateDeps>
  & Omit<DiscountNotificationServiceDeps, GeneratedDiscountDeps>
  & {
    canSendEmbeds(channel: unknown, botId: string): boolean;
  }
  & Record<string, unknown>;

function createNotificationRuntime(deps: NotificationsContext) {
  const {
    GuildModel, logger, DEFAULT_CURRENCY, runConcurrent,
    validatePendingDiscountSnapshot, getLatestForAllGames, fetchDeals,
    enrichDealData, dealHash, canSendEmbeds, buildUpdateEmbed,
    buildDealEmbed, setUpdatesCache, getDealsCacheData, setDealsCache,
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

  const resolveOutboundChannel = createOutboundChannelResolver({ logger, canSendEmbeds });

  const seenRepository = createSeenRepository({
    GuildModel, withMongoRetry, SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS
  });
  const {
    claimSeenUpdate, rollbackSeenUpdate, disableUpdatesForChannelError,
    claimSeenDiscount, rollbackSeenDiscount, disableDiscountsForChannelError
  } = seenRepository;

  const updateService = createUpdateNotificationService({
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, disableUpdatesForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, setUpdatesCache, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });

  const discountService = createDiscountNotificationService({
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenDiscount, rollbackSeenDiscount, disableDiscountsForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingDiscountArray, validatePendingDiscountSnapshot,
    normalizeCurrencyKey, dealPassesFilters, dealHash,
    fetchDeals, getDealsCacheData, setDealsCache, enrichDealData, buildDealEmbed,
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
    disableUpdatesForChannelError,
    processGuildUpdates: updateService.processGuildUpdates,
    buildOptimizedGameList: updateService.buildOptimizedGameList,
    checkForUpdates: updateService.checkForUpdates,
    claimSeenDiscount,
    rollbackSeenDiscount,
    disableDiscountsForChannelError,
    processGuildDiscounts: discountService.processGuildDiscounts,
    checkForDiscounts: discountService.checkForDiscounts
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
