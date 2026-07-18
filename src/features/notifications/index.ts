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
import { createDlcNotificationRuntime } from "./dlcNotificationRuntime.js";
import { createYouTubeNotificationRuntime } from "./youtubeNotificationRuntime.js";
import { createFutureReleaseNotificationRuntime } from "./futureReleaseNotificationRuntime.js";

function createNotificationDispatchServices(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver,
  seenRepository: SeenServices
) {
  const updateService = createUpdateNotificationRuntime(deps, resolveOutboundChannel, seenRepository);
  const { discountService, priceAlertService } = createDiscountNotificationRuntime(deps, resolveOutboundChannel, seenRepository);
  const { dlcService } = createDlcNotificationRuntime(deps, resolveOutboundChannel, seenRepository);
  const { youtubeSource, youtubeRepository, youtubeService } = createYouTubeNotificationRuntime(deps, resolveOutboundChannel);
  const futureReleaseService = createFutureReleaseNotificationRuntime(deps, resolveOutboundChannel);

  return {
    updateService,
    discountService,
    priceAlertService,
    dlcService,
    youtubeSource,
    youtubeRepository,
    youtubeService,
    futureReleaseService
  };
}

function createNotificationRuntime(deps: NotificationsRuntimeDeps) {
  const { enqueueOutbox, resolveOutboundChannel, drainOutbox, deadLetterReplayRepository, historyRepository } = createOutboxServices(deps);
  const seenRepository = createSeenServices(deps);
  const {
    updateService,
    discountService,
    priceAlertService,
    dlcService,
    youtubeSource,
    youtubeRepository,
    youtubeService,
    futureReleaseService
  } = createNotificationDispatchServices(deps, resolveOutboundChannel, seenRepository);
  const {
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, disableUpdatesForChannelError,
    claimSeenDiscount, rollbackSeenDiscount, seedSeenDiscounts, disableDiscountsForChannelError,
    claimSeenDlc, rollbackSeenDlc, seedSeenDlcs, loadSeenDlcKeys, disableDlcForChannelError
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
    claimSeenDlc,
    rollbackSeenDlc,
    seedSeenDlcs,
    loadSeenDlcKeys,
    disableDlcForChannelError,
    processGuildDlcs: dlcService.processGuildDlcs,
    checkForDlcs: dlcService.checkForDlcs,
    seedBaselineDlc: dlcService.seedBaselineDlc,
    checkForFutureReleases: futureReleaseService.checkForFutureReleases,
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

export default notificationsModule;
