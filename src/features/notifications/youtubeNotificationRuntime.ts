"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory";
import { createReportRollbackFailure } from "./notificationRuntimeContracts";

const { transientErrorMessage } = require("./outboundChannel") as typeof import("./outboundChannel");
const { createYouTubeSource } = require("../youtube/youtubeSource") as typeof import("../youtube/youtubeSource");
const { createYouTubeRepository } = require("../youtube/youtubeRepository") as typeof import("../youtube/youtubeRepository");
const { createYouTubeNotificationService } = require("../youtube/youtubeNotificationService") as typeof import("../youtube/youtubeNotificationService");

export function createYouTubeNotificationRuntime(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver
) {
  const { logger, runConcurrent, sleepIfPositive, GUILD_PROCESS_CONCURRENCY } = deps;
  const reportRollbackFailure = createReportRollbackFailure(deps);

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
    FETCH_CONCURRENCY: deps.FETCH_CONCURRENCY,
    reportRollbackFailure
  });

  return { youtubeSource, youtubeRepository, youtubeService };
}

export type YouTubeNotificationRuntime = ReturnType<typeof createYouTubeNotificationRuntime>;
