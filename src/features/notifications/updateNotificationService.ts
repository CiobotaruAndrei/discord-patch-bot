"use strict";

import type { FilterQuery, Model } from "mongoose";
import type { GuildSettings } from "../../types";
import { buildPendingUpdatesQueue, PendingUpdate, UpdateFetchResult } from "./pendingUpdatesQueue";
import { buildDeadLetterEntry, DeadLetterEntry, deadLetterPush } from "./deadLetter";

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

interface MongoWriteResult { matchedCount?: number; modifiedCount?: number }

interface OutboundChannel {
  id: string;
  send: (payload: unknown) => Promise<unknown>;
}

interface ResolvedChannel {
  channel: OutboundChannel;
  abort: boolean;
}

type ResolveOutboundChannel = (opts: {
  client: unknown;
  guild: GuildSettings & Record<string, unknown>;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolvedChannel>;

interface RunConcurrentOptions {
  errorLogger?: (item: unknown, err: unknown) => void;
}
type RunConcurrent = <T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>, opts?: RunConcurrentOptions) => Promise<void>;

export interface UpdateNotificationServiceDeps {
  GuildModel: Pick<Model<GuildSettings>, "find" | "updateOne">;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;

  claimSeenUpdate: (guildId: string, channelId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  rollbackSeenUpdate: (guildId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  disableUpdatesForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;

  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;

  normalizePendingUpdateArray: (arr: unknown) => PendingUpdate[];
  toEntries: <K, V>(map: Map<K, V> | Record<string, V> | undefined) => Array<[K, V]>;
  rotateAfter: <T>(arr: T[], lastSeen: T | null) => T[];
  mapToObject: <V>(map: Map<string, V>) => Record<string, V>;

  getLatestForAllGames: (games: unknown[], shouldAbort?: (() => boolean) | null) => Promise<UpdateFetchResult[]>;
  setUpdatesCache: (data: UpdateFetchResult[]) => void;
  buildUpdateEmbed: (gameName: string, latest: unknown, mode: string) => unknown;

  sleepIfPositive: (ms: number) => Promise<void>;

  PENDING_UPDATE_MAX_AGE_MS: number;
  PENDING_UPDATE_MAX_ATTEMPTS: number;
  PENDING_UPDATES_PER_GAME_LIMIT: number;
  MAX_UPDATES_PER_CYCLE: number;
  DISCORD_SEND_DELAY_MS: number;
  GUILD_PROCESS_CONCURRENCY: number;
}

export interface UpdateNotificationService {
  processGuildUpdates: (client: unknown, guild: GuildSettings & Record<string, unknown>, latestResults: UpdateFetchResult[]) => Promise<void>;
  buildOptimizedGameList: <G extends { key: string }>(allGames: G[], subscribedGuilds: Array<{ enabledGames?: unknown[] }>) => G[];
  checkForUpdates: (client: unknown, games: unknown[], shouldAbort?: (() => boolean) | null) => Promise<void>;
}

export function createUpdateNotificationService(deps: UpdateNotificationServiceDeps): UpdateNotificationService {
  const {
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, disableUpdatesForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, setUpdatesCache, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  } = deps;

  async function processGuildUpdates(
    client: unknown,
    guild: GuildSettings & Record<string, unknown>,
    latestResults: UpdateFetchResult[]
  ): Promise<void> {
    const { channel, abort } = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.notificationChannelId,
      context: "CRON_UPDATES",
      disableFn: disableUpdatesForChannelError
    });
    if (abort) return;

    const deadLettered: DeadLetterEntry[] = [];
    const { pendingByGame, resultByGameKey } = buildPendingUpdatesQueue({
      normalizePendingUpdateArray, toEntries,
      PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
      PENDING_UPDATES_PER_GAME_LIMIT
    }, { guild, latestResults });

    let sentCount = 0;
    let lastProcessedGameKey: string | null = (guild as { lastProcessedGameKey?: string | null }).lastProcessedGameKey || null;
    while (sentCount < MAX_UPDATES_PER_CYCLE) {
      const keys = Array.from(pendingByGame.keys()).filter(key => (pendingByGame.get(key) || []).length);
      if (!keys.length) break;
      const gameKey = rotateAfter(keys, lastProcessedGameKey)[0] as string;
      const queue = pendingByGame.get(gameKey) || [];
      const next = queue.shift();
      if (!next) { pendingByGame.delete(gameKey); continue; }
      const game = resultByGameKey.get(gameKey)?.game || { name: gameKey, key: gameKey };
      const claim = await claimSeenUpdate(String(guild._id), channel.id, gameKey, next.id);
      if ((claim.matchedCount ?? 0) === 0) {
        if (queue.length) pendingByGame.set(gameKey, queue);
        else pendingByGame.delete(gameKey);
        continue;
      }
      try {
        const sendPayload: Record<string, unknown> = {
          embeds: [buildUpdateEmbed(game.name, next, (guild as { notificationMode?: string }).notificationMode || "detailed")]
        };
        const notificationRoleId = (guild as { notificationRoleId?: string }).notificationRoleId;
        if (sentCount === 0 && notificationRoleId) {
          sendPayload.content = `<@&${notificationRoleId}>`;
          sendPayload.allowedMentions = { roles: [notificationRoleId] };
        }
        await channel.send(sendPayload);
        sentCount++;
        lastProcessedGameKey = gameKey;
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      } catch (err: unknown) {
        await rollbackSeenUpdate(String(guild._id), gameKey, next.id).catch(() => null);
        if (isPermanentDiscordError(err)) {
          const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
          await disableUpdatesForChannelError(String(guild._id), channel.id, reason).catch(() => null);
          logger("WARN", "CRON_UPDATES", `Disable updates pentru guild ${guild._id} - cod permanent`, reason);
          break;
        }
        next.attempts = (next.attempts || 0) + 1;
        if (next.attempts < PENDING_UPDATE_MAX_ATTEMPTS) queue.unshift(next);
        else deadLettered.push(buildDeadLetterEntry({
          kind: "update", itemId: next.id, title: (next as { title?: unknown }).title,
          reason: transientErrorMessage(err), attempts: next.attempts
        }));
        logger("WARN", "CRON_UPDATES", `Nu am putut trimite update pentru ${gameKey}`, transientErrorMessage(err));
        break;
      }
      if (queue.length) pendingByGame.set(gameKey, queue);
      else pendingByGame.delete(gameKey);
    }

    const pendingObject = mapToObject(pendingByGame);
    const setDoc: Record<string, unknown> = { pendingUpdates: pendingObject };
    if (lastProcessedGameKey) setDoc.lastProcessedGameKey = lastProcessedGameKey;
    const update: Record<string, unknown> = { $set: setDoc };
    const push = deadLetterPush(deadLettered);
    if (push) update.$push = push;
    await GuildModel.updateOne(
      { _id: guild._id, subscribed: true, notificationChannelId: channel.id } as FilterQuery<GuildSettings>,
      update
    );
  }

  function buildOptimizedGameList<G extends { key: string }>(
    allGames: G[],
    subscribedGuilds: Array<{ enabledGames?: unknown[] }>
  ): G[] {
    if (!Array.isArray(subscribedGuilds) || subscribedGuilds.length === 0) return allGames;

    const used = new Set<string>();
    for (const guild of subscribedGuilds) {
      const filter = Array.isArray(guild.enabledGames) ? guild.enabledGames : [];
      if (filter.length === 0) return allGames;
      for (const key of filter) used.add(String(key).toLowerCase());
    }

    const filtered = allGames.filter(game => used.has(String(game.key).toLowerCase()));
    return filtered.length > 0 ? filtered : allGames;
  }

  async function checkForUpdates(client: unknown, games: unknown[], shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;

    const guilds = await GuildModel.find({
      subscribed: true,
      notificationChannelId: { $ne: null },
      updatesInitializing: { $ne: true }
    } as FilterQuery<GuildSettings>).lean();
    if (!guilds.length) return;

    const optimizedGames = buildOptimizedGameList(games as Array<{ key: string }>, guilds as Array<{ enabledGames?: unknown[] }>);
    if (optimizedGames.length < games.length) {
      logger("INFO", "CRON_UPDATES", `Lista optimizata: ${optimizedGames.length}/${games.length} jocuri folosite de guild-uri`);
    }

    let latestResults: UpdateFetchResult[];
    try {
      latestResults = await getLatestForAllGames(optimizedGames, shouldAbort);

      if (optimizedGames.length === games.length) {
        setUpdatesCache(latestResults);
      }
    } catch (err: unknown) {
      logger("ERROR", "CRON_UPDATES", "Nu am putut prelua update-urile", transientErrorMessage(err));
      return;
    }
    if (shouldAbort?.()) return;

    await runConcurrent(guilds as Array<GuildSettings & Record<string, unknown>>, GUILD_PROCESS_CONCURRENCY, async (guild) => {
      if (!shouldAbort?.()) await processGuildUpdates(client, guild, latestResults);
    }, {
      errorLogger: (guild: unknown, err: unknown) =>
        logger("WARN", "CRON_UPDATES", `Eroare procesare guild ${(guild as { _id?: unknown })._id}`, transientErrorMessage(err))
    });
  }

  return { processGuildUpdates, buildOptimizedGameList, checkForUpdates };
}
