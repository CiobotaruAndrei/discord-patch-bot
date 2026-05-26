"use strict";

/**
 * V12: UpdateNotificationService — extras din `notifications/index.ts` ca parte
 * a continuarii splitting-ului review-ului extern (notifications/index era una
 * dintre cele mai mari zone de complexitate cu ~330 linii si ~30 deps ctx).
 *
 * Modulul concentreaza intregul flow de notificari de update-uri:
 * - `processGuildUpdates`: per guild, draina coada pendingUpdates, dispatcheaza
 *   maxim N updates/ciclu cu retry tolerant si rollback pe blip-uri Mongo.
 * - `buildOptimizedGameList`: filtreaza lista globala de jocuri la cele active
 *   pe macar un guild — economiseste fetch-uri Steam/Epic per ciclu.
 * - `checkForUpdates`: top-level cron entry — interogheaza guild-urile
 *   subscribed, fetch-uieste si proceseaza in paralel.
 *
 * Deps tipate explicit (no `ctx: any`). Functiile depinde de SeenRepository
 * (claim/rollback/disable) si OutboundChannelResolver injectate, fara apel
 * direct la Mongo/Discord.
 */

import type { Model } from "mongoose";
import type { GuildSettings } from "../../types";

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;

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

interface PendingUpdate {
  id: string;
  title?: string;
  link?: string;
  excerpt?: string;
  thumbnail?: unknown;
  image?: unknown;
  timestamp?: string;
  createdAt: Date;
  attempts: number;
}

interface UpdateFetchResult {
  game: { key: string; name: string } & Record<string, unknown>;
  latest: ({ id: string } & Record<string, unknown>) | null;
}

export interface UpdateNotificationServiceDeps {
  GuildModel: Pick<Model<GuildSettings>, "find" | "updateOne">;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;
  // SeenRepository operations
  claimSeenUpdate: (guildId: string, channelId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  rollbackSeenUpdate: (guildId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  disableUpdatesForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
  // Discord helpers
  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;
  // Pure utils
  normalizePendingUpdateArray: (arr: unknown) => PendingUpdate[];
  toEntries: <K, V>(map: Map<K, V> | Record<string, V> | undefined) => Array<[K, V]>;
  rotateAfter: <T>(arr: T[], lastSeen: T | null) => T[];
  mapToObject: <V>(map: Map<string, V>) => Record<string, V>;
  // Fetch + embed
  getLatestForAllGames: (games: unknown[], shouldAbort?: (() => boolean) | null) => Promise<UpdateFetchResult[]>;
  setUpdatesCache: (data: UpdateFetchResult[]) => void;
  buildUpdateEmbed: (gameName: string, latest: unknown, mode: string) => unknown;
  // Misc
  sleepIfPositive: (ms: number) => Promise<void>;
  // Limits
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

  // V9: filtram per joc + mentiune rol pe prima trimitere doar.
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

    // V11: indexam latestResults dupa cheia jocului ca lookup-ul ulterior din
    // bucla de trimitere sa fie O(1) in loc sa parcurga linear toata lista la
    // fiecare iteratie.
    const resultByGameKey = new Map<string, UpdateFetchResult>();
    for (const result of latestResults) {
      if (result?.game?.key) resultByGameKey.set(result.game.key, result);
    }

    // V9: daca guild-ul are lista explicita de jocuri active, filtram.
    const enabledGames = Array.isArray(guild.enabledGames) ? guild.enabledGames : [];
    const hasGameFilter = enabledGames.length > 0;
    const enabledSet = new Set(enabledGames);

    const now = Date.now();
    const pendingByGame = new Map<string, PendingUpdate[]>();
    const seenByGame = new Map<string, Set<string>>();
    for (const [gameKey, seen] of toEntries<string, unknown>(guild.seen as any)) {
      seenByGame.set(gameKey, new Set(Array.isArray(seen) ? seen.map(String) : []));
    }
    for (const [gameKey, arr] of toEntries<string, unknown>(guild.pendingUpdates as any)) {
      if (hasGameFilter && !enabledSet.has(gameKey)) continue;
      const seenSet = seenByGame.get(gameKey) || new Set<string>();
      const cleaned = normalizePendingUpdateArray(arr).filter(item => {
        const age = now - new Date(item.createdAt).getTime();
        return !seenSet.has(item.id)
          && age <= PENDING_UPDATE_MAX_AGE_MS
          && item.attempts < PENDING_UPDATE_MAX_ATTEMPTS;
      }).slice(-PENDING_UPDATES_PER_GAME_LIMIT);
      if (cleaned.length) pendingByGame.set(gameKey, cleaned);
    }

    for (const result of latestResults) {
      if (!result?.game?.key || !result.latest) continue;
      const gameKey = result.game.key;
      if (hasGameFilter && !enabledSet.has(gameKey)) continue;
      const seenSet = seenByGame.get(gameKey) || new Set<string>();
      const queue = pendingByGame.get(gameKey) || [];
      if (!seenSet.has(result.latest.id) && !queue.some(item => item.id === result.latest!.id)) {
        queue.push({ ...result.latest, createdAt: new Date(), attempts: 0 } as PendingUpdate);
        pendingByGame.set(gameKey, queue.slice(-PENDING_UPDATES_PER_GAME_LIMIT));
      }
    }

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
        // V9: prima trimitere pingeaza rolul (daca e setat), restul nu - anti-spam.
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
        logger("WARN", "CRON_UPDATES", `Nu am putut trimite update pentru ${gameKey}`, transientErrorMessage(err));
        break;
      }
      if (queue.length) pendingByGame.set(gameKey, queue);
      else pendingByGame.delete(gameKey);
    }

    const pendingObject = mapToObject(pendingByGame);
    const setDoc: Record<string, unknown> = { pendingUpdates: pendingObject };
    if (lastProcessedGameKey) setDoc.lastProcessedGameKey = lastProcessedGameKey;
    await GuildModel.updateOne(
      { _id: guild._id, subscribed: true, notificationChannelId: channel.id } as any,
      { $set: setDoc }
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
    } as any).lean();
    if (!guilds.length) return;

    const optimizedGames = buildOptimizedGameList(games as Array<{ key: string }>, guilds as Array<{ enabledGames?: unknown[] }>);
    if (optimizedGames.length < games.length) {
      logger("INFO", "CRON_UPDATES", `Lista optimizata: ${optimizedGames.length}/${games.length} jocuri folosite de guild-uri`);
    }

    let latestResults: UpdateFetchResult[];
    try {
      latestResults = await getLatestForAllGames(optimizedGames, shouldAbort);
      setUpdatesCache(latestResults);
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
