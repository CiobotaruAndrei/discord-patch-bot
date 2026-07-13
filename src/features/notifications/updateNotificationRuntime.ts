"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory";
import type { SeenServices } from "./seenRuntimeFactory";

import { isPermanentDiscordError, transientErrorMessage } from "./outboundChannel";
import { createUpdateNotificationService } from "./updateNotificationService";

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
  const persistFetchSnapshot = saveFetchSnapshot as ((id: string, payload: unknown) => Promise<void>) | undefined;
  const loadSnapshot = loadFetchSnapshot as ((id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>) | undefined;

  return createUpdateNotificationService({
    GuildModel, GuildDeadLetterModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, setSeenHashVersion, disableUpdatesForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, validateUpdateFetchSnapshot, setUpdatesCache, persistFetchSnapshot, loadFetchSnapshot: loadSnapshot, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  });
}

export type UpdateNotificationRuntime = ReturnType<typeof createUpdateNotificationRuntime>;
