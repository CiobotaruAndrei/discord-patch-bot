"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory";
import type { SeenServices } from "./seenRuntimeFactory";

const {
  DISCORD_PERMANENT_ERROR_CODES,
  isPermanentDiscordError,
  transientErrorMessage
} = require("./outboundChannel") as typeof import("./outboundChannel");
const { createOutboxServices, createIsStillSubscribed, outboxSubscriptionFilter } = require("./outboxRuntimeFactory") as typeof import("./outboxRuntimeFactory");
const { createSeenServices } = require("./seenRuntimeFactory") as typeof import("./seenRuntimeFactory");
const { createUpdateNotificationRuntime } = require("./updateNotificationRuntime") as typeof import("./updateNotificationRuntime");
const { createDiscountNotificationRuntime } = require("./discountNotificationRuntime") as typeof import("./discountNotificationRuntime");
const { createYouTubeNotificationRuntime } = require("./youtubeNotificationRuntime") as typeof import("./youtubeNotificationRuntime");

function createNotificationDispatchServices(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver,
  seenRepository: SeenServices
) {
  const updateService = createUpdateNotificationRuntime(deps, resolveOutboundChannel, seenRepository);
  const { discountService, priceAlertService } = createDiscountNotificationRuntime(deps, resolveOutboundChannel, seenRepository);
  const { youtubeSource, youtubeRepository, youtubeService } = createYouTubeNotificationRuntime(deps, resolveOutboundChannel);

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

const notificationsModule = {
  createNotificationRuntime,
  createIsStillSubscribed,
  outboxSubscriptionFilter
};

export = notificationsModule;
