"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory";
import type { SeenServices } from "./seenRuntimeFactory";
import { createReportRollbackFailure } from "./notificationRuntimeContracts";

const { isPermanentDiscordError, transientErrorMessage } = require("./outboundChannel") as typeof import("./outboundChannel");
const { createDiscountNotificationService } = require("./discountNotificationService") as typeof import("./discountNotificationService");
const { createPriceAlertService } = require("./priceAlertService") as typeof import("./priceAlertService");

export function createDiscountNotificationRuntime(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver,
  seenRepository: SeenServices
) {
  const {
    GuildModel, logger, DEFAULT_CURRENCY, runConcurrent,
    validatePendingDiscountSnapshot, fetchDeals, enrichDealData, dealHash,
    buildDealEmbed, getDealsCacheData, setDealsCache,
    saveFetchSnapshot, loadFetchSnapshot,
    normalizeCurrencyKey, normalizePendingDiscountArray, dealPassesFilters, sleepIfPositive,
    DEALS_HISTORY_LIMIT, PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE, DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY,
    PRICE_ALERT_REARM_ABSENT_CYCLES
  } = deps;
  const {
    claimSeenDiscount, rollbackSeenDiscount, seedSeenDiscounts, loadSeenDiscountHashes,
    disableDiscountsForChannelError, setSeenHashVersion
  } = seenRepository;
  const persistFetchSnapshot = saveFetchSnapshot as ((id: string, payload: unknown) => Promise<void>) | undefined;
  const loadSnapshot = loadFetchSnapshot as ((id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>) | undefined;
  const reportRollbackFailure = createReportRollbackFailure(deps);

  const priceAlertService = createPriceAlertService({
    GuildModel,
    logger,
    resolveOutboundChannel,
    disableDiscountsForChannelError,
    rollbackTriggeredAlert: seenRepository.rollbackTriggeredAlert,
    formatPrice: deps.formatPrice,
    sleepIfPositive,
    DISCORD_SEND_DELAY_MS,
    rearmAbsentCycles: PRICE_ALERT_REARM_ABSENT_CYCLES,
    reportRollbackFailure
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

  return { discountService, priceAlertService };
}

export type DiscountNotificationRuntime = ReturnType<typeof createDiscountNotificationRuntime>;
