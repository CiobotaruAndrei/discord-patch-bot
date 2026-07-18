"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts.js";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory.js";
import type { SeenServices } from "./seenRuntimeFactory.js";

import {
  DISCORD_PERMANENT_ERROR_CODES,
  isPermanentDiscordError,
  transientErrorMessage
} from "./outboundChannel.js";
import { createOutboxServices, createIsStillSubscribed, outboxSubscriptionFilter } from "./outboxRuntimeFactory.js";
import { createSeenServices } from "./seenRuntimeFactory.js";
import { createUpdateNotificationRuntime } from "./updateNotificationRuntime.js";
import { createDiscountNotificationRuntime } from "./discountNotificationRuntime.js";
import { createYouTubeNotificationRuntime } from "./youtubeNotificationRuntime.js";
import type { NotificationStatePorts } from "./notificationStatePorts.js";

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
  const statePorts: NotificationStatePorts = { history: historyRepository, seen: seenRepository };

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
    getNotificationHistory: historyRepository.getRecent,
    statePorts
  };
}

const notificationsModule = {
  createNotificationRuntime,
  createIsStillSubscribed,
  outboxSubscriptionFilter
};

export default notificationsModule;
