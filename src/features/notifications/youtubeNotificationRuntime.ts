"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts.js";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory.js";
import { createReportRollbackFailure } from "./notificationRuntimeContracts.js";

import { transientErrorMessage } from "./outboundChannel.js";
import { createYouTubeSource } from "../youtube/youtubeSource.js";
import { createYouTubeRepository } from "../youtube/youtubeRepository.js";
import { createYouTubeNotificationService } from "../youtube/youtubeNotificationService.js";
import { createYoutubeStateReader } from "../youtube/youtubeStateReader.js";

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
    GuildYoutubeErrorModel: deps.GuildYoutubeErrorModel,
    withMongoRetry: deps.withMongoRetry,
    adminAlert: async (kind, title, body, guildId) => {
      await deps.adminAlert?.(kind, title, body, guildId);
    },
    logger
  });
  const youtubeStateReader = createYoutubeStateReader({
    guildModel: deps.GuildModel,
    stateModel: deps.GuildYoutubeStateModel,
    onMissingCopy: guildId => {
      logger("WARN", "YOUTUBE_STATE", `Copia dedicata lipsea pentru ${guildId}; se reface din documentul vechi`);
    },
    onRepairFailed: (guildId, error) => {
      logger("ERROR", "YOUTUBE_STATE", `Copia dedicata nu a putut fi refacuta pentru ${guildId}`, error);
    }
  });
  const youtubeService = createYouTubeNotificationService({
    listActiveGuilds: youtubeStateReader.listActiveGuilds,
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

  return { youtubeSource, youtubeRepository, youtubeService, youtubeStateReader };
}

export type YouTubeNotificationRuntime = ReturnType<typeof createYouTubeNotificationRuntime>;
