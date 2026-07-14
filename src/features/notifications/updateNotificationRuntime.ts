"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts.js";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory.js";
import type { SeenServices } from "./seenRuntimeFactory.js";

import { isPermanentDiscordError, transientErrorMessage } from "./outboundChannel.js";
import { createUpdateNotificationService } from "./updateNotificationService.js";
import { createReportRollbackFailure } from "./notificationRuntimeContracts.js";

export function createUpdateNotificationRuntime(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver,
  seenRepository: SeenServices
) {
  const {
    GuildModel, GuildDeadLetterModel, logger, runConcurrent,
    validateUpdateFetchSnapshot, getLatestForAllGames, buildUpdateEmbed, setUpdatesCache,
    saveFetchSnapshot, loadFetchSnapshot,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS, PENDING_UPDATES_PER_GAME_LIMIT,
    MAX_UPDATES_PER_CYCLE, DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  } = deps;
  const { claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, disableUpdatesForChannelError, setSeenHashVersion } = seenRepository;
  const reportRollbackFailure = createReportRollbackFailure(deps);

  return createUpdateNotificationService({
    GuildModel, GuildDeadLetterModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, setSeenHashVersion, disableUpdatesForChannelError, reportRollbackFailure,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, validateUpdateFetchSnapshot, setUpdatesCache, persistFetchSnapshot: saveFetchSnapshot, loadFetchSnapshot, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });
}

export type UpdateNotificationRuntime = ReturnType<typeof createUpdateNotificationRuntime>;
