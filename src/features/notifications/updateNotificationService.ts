"use strict";

import type { GameConfig } from "../../types";
import type { GuildSettings, EmbeddableUpdate, NotificationMode } from "../../types";
import { buildPendingUpdatesQueue, PendingUpdate, UpdateFetchResult } from "./pendingUpdatesQueue";
import { buildDeadLetterEntry, DeadLetterEntry, deadLetterPush } from "./deadLetter";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel";
import { HASH_VERSION } from "../../native/fuzzy";
import { packEmbedsByBudget, embedCharCost } from "../../shared/discordEmbedChunks";
import { buildNotificationContent } from "./notificationTemplate";
import { planPendingFailure, planRebaselineEntries, requeueFront, takeNextPending } from "./updateNotificationPlanner";

const DISCORD_EMBEDS_PER_MESSAGE = 10;
const SNAPSHOT_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

interface MongoWriteResult { matchedCount?: number; modifiedCount?: number }
type GuildGameFilter = Pick<GuildSettings, "enabledGames">;
type GuildSettingsDoc = GuildSettings;

interface GuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<GuildSettingsDoc[]> };
  updateOne(filter: Record<string, unknown>, update: unknown): Promise<MongoWriteResult>;
}


type ResolveOutboundChannel = (opts: {
  client: NotificationDiscordClient;
  guild: GuildSettings;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolveOutboundChannelResult>;

interface RunConcurrentOptions {
  errorLogger?: (item: unknown, err: unknown) => void;
}
interface RunConcurrentResult {
  processed: number;
  errors: Array<{ error: unknown }>;
}
type RunConcurrent = <T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>, opts?: RunConcurrentOptions) => Promise<RunConcurrentResult>;

export interface UpdateNotificationServiceDeps {
  GuildModel: GuildModelLike;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;

  claimSeenUpdate: (guildId: string, channelId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  rollbackSeenUpdate: (guildId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  seedSeenUpdates: (guildId: string, entries: Array<{ gameKey: string; updateId: string }>) => Promise<void>;
  setSeenHashVersion: (guildId: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number) => Promise<MongoWriteResult>;
  disableUpdatesForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;

  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;

  normalizePendingUpdateArray: (arr: unknown) => PendingUpdate[];
  toEntries: (map: Map<string, unknown> | Record<string, unknown> | undefined) => Array<[string, unknown]>;
  rotateAfter: <T>(arr: T[], lastSeen: T | null) => T[];
  mapToObject: <V>(map: Map<string, V>) => Record<string, V>;

  getLatestForAllGames: (games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<UpdateFetchResult[]>;
  validateUpdateFetchSnapshot: (item: unknown) => boolean;
  setUpdatesCache: (data: UpdateFetchResult[]) => void;
  persistFetchSnapshot?: (id: string, payload: unknown) => Promise<void>;
  loadFetchSnapshot?: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  buildUpdateEmbed: (gameName: string, latest: EmbeddableUpdate, mode: NotificationMode) => unknown;

  sleepIfPositive: (ms: number) => Promise<void>;

  PENDING_UPDATE_MAX_AGE_MS: number;
  PENDING_UPDATE_MAX_ATTEMPTS: number;
  PENDING_UPDATES_PER_GAME_LIMIT: number;
  MAX_UPDATES_PER_CYCLE: number;
  DISCORD_SEND_DELAY_MS: number;
  GUILD_PROCESS_CONCURRENCY: number;
}

export interface UpdateNotificationService {
  processGuildUpdates: (client: NotificationDiscordClient, guild: GuildSettingsDoc, latestResults: UpdateFetchResult[]) => Promise<void>;
  buildOptimizedGameList: <G extends { key: string }>(allGames: G[], subscribedGuilds: readonly GuildGameFilter[]) => G[];
  checkForUpdates: (client: NotificationDiscordClient, games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<void>;
}

export function createUpdateNotificationService(deps: UpdateNotificationServiceDeps): UpdateNotificationService {
  const {
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, setSeenHashVersion, disableUpdatesForChannelError,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, validateUpdateFetchSnapshot, setUpdatesCache, persistFetchSnapshot, loadFetchSnapshot, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  } = deps;

  async function processGuildUpdates(
    client: NotificationDiscordClient,
    guild: GuildSettingsDoc,
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

    if (Number(guild.seenHashVersionUpdates) !== HASH_VERSION) {
      const entries = planRebaselineEntries(resultByGameKey);
      if (entries.length) await seedSeenUpdates(String(guild._id), entries);
      await setSeenHashVersion(String(guild._id), "seenHashVersionUpdates", HASH_VERSION);
      logger("INFO", "CRON_UPDATES", `Re-baseline dedup update-uri pentru guild ${guild._id} (hashVersion -> ${HASH_VERSION}); ciclul curent nu trimite notificari`);
      return;
    }

    const notificationMode: NotificationMode = (guild as { notificationMode?: string }).notificationMode === "compact" ? "compact" : "detailed";
    const batch: Array<{ gameKey: string; item: PendingUpdate; embed: unknown }> = [];
    let lastProcessedGameKey: string | null = (guild as { lastProcessedGameKey?: string | null }).lastProcessedGameKey || null;
    while (batch.length < MAX_UPDATES_PER_CYCLE) {
      const selection = takeNextPending(pendingByGame, lastProcessedGameKey, rotateAfter);
      if (!selection) break;
      const { gameKey, item: next } = selection;
      lastProcessedGameKey = gameKey;
      const claim = await claimSeenUpdate(String(guild._id), channel.id, gameKey, next.id);
      if ((claim.matchedCount ?? 0) === 0) continue;
      const game = resultByGameKey.get(gameKey)?.game || { name: gameKey, key: gameKey };
      let embed: unknown;
      try {
        embed = buildUpdateEmbed(game.name, next, notificationMode);
      } catch (embedErr: unknown) {
        await rollbackSeenUpdate(String(guild._id), gameKey, next.id).catch(() => null);
        const embedFailure = planPendingFailure(next, PENDING_UPDATE_MAX_ATTEMPTS);
        if (embedFailure.action === "requeue") {
          requeueFront(pendingByGame, gameKey, next);
        } else {
          deadLettered.push(buildDeadLetterEntry({
            kind: "update", itemId: next.id, title: next.title,
            reason: transientErrorMessage(embedErr), attempts: embedFailure.attempts
          }));
        }
        logger("WARN", "CRON_UPDATES", `buildUpdateEmbed a esuat pentru ${gameKey}/${next.id}; claim-ul a fost dat inapoi`, transientErrorMessage(embedErr));
        continue;
      }
      batch.push({ gameKey, item: next, embed });
    }

    const notificationRoleId = (guild as { notificationRoleId?: string }).notificationRoleId;
    const messageTemplate = (guild as { updateMessageTemplate?: string | null }).updateMessageTemplate;
    const messageChunks = packEmbedsByBudget(batch, entry => embedCharCost(entry.embed), { maxCount: DISCORD_EMBEDS_PER_MESSAGE });
    for (let ci = 0; ci < messageChunks.length; ci++) {
      const chunk = messageChunks[ci];
      const sendPayload: Record<string, unknown> = { embeds: chunk.map(entry => entry.embed) };
      if (ci === 0) {
        Object.assign(sendPayload, buildNotificationContent(messageTemplate, { count: batch.length }, notificationRoleId || null));
      }
      try {
        await channel.send(sendPayload, {
          historyEntries: chunk.map(entry => ({
            kind: "update" as const,
            gameKey: entry.gameKey,
            title: String((entry.item as { title?: unknown }).title || ""),
            link: String((entry.item as { link?: unknown }).link || ""),
            itemId: String((entry.item as { id?: unknown }).id || "")
          }))
        });
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      } catch (err: unknown) {
        const failed = messageChunks.slice(ci).reduce<typeof batch>((acc, c) => { for (const entry of c) acc.push(entry); return acc; }, []);
        for (const entry of failed) await rollbackSeenUpdate(String(guild._id), entry.gameKey, entry.item.id).catch(() => null);
        if (isPermanentDiscordError(err)) {
          const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
          await disableUpdatesForChannelError(String(guild._id), channel.id, reason).catch(() => null);
          logger("WARN", "CRON_UPDATES", `Disable updates pentru guild ${guild._id} - cod permanent`, reason);
          break;
        }
        for (let j = failed.length - 1; j >= 0; j--) {
          const entry = failed[j];
          const sendFailure = planPendingFailure(entry.item, PENDING_UPDATE_MAX_ATTEMPTS);
          if (sendFailure.action === "requeue") {
            requeueFront(pendingByGame, entry.gameKey, entry.item);
          } else {
            deadLettered.push(buildDeadLetterEntry({
              kind: "update", itemId: entry.item.id, title: (entry.item as { title?: unknown }).title,
              reason: transientErrorMessage(err), attempts: sendFailure.attempts
            }));
          }
        }
        logger("WARN", "CRON_UPDATES", `Nu am putut trimite update-uri pentru guild ${guild._id}`, transientErrorMessage(err));
        break;
      }
    }

    const pendingObject = mapToObject(pendingByGame);
    const setDoc: Record<string, unknown> = { pendingUpdates: pendingObject };
    if (lastProcessedGameKey) setDoc.lastProcessedGameKey = lastProcessedGameKey;
    const update: Record<string, unknown> = { $set: setDoc };
    const push = deadLetterPush(deadLettered);
    if (push) update.$push = push;
    await GuildModel.updateOne(
      { _id: guild._id, subscribed: true, notificationChannelId: channel.id },
      update
    );
  }

  function buildOptimizedGameList<G extends { key: string }>(
    allGames: G[],
    subscribedGuilds: readonly GuildGameFilter[]
  ): G[] {
    if (!Array.isArray(subscribedGuilds) || subscribedGuilds.length === 0) return allGames;

    const used = new Set<string>();
    for (const guild of subscribedGuilds) {
      const filter = Array.isArray(guild.enabledGames) ? guild.enabledGames : [];
      if (filter.length === 0) return allGames;
      for (const key of filter) used.add(key.toLowerCase());
    }

    const filtered = allGames.filter(game => used.has(String(game.key).toLowerCase()));
    return filtered.length > 0 ? filtered : allGames;
  }

  async function checkForUpdates(client: NotificationDiscordClient, games: GameConfig[], shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;

    const guilds = await GuildModel.find({
      subscribed: true,
      notificationChannelId: { $ne: null },
      updatesInitializing: { $ne: true }
    }).lean();
    if (!guilds.length) return;

    const optimizedGames = buildOptimizedGameList(games, guilds);
    if (optimizedGames.length < games.length) {
      logger("INFO", "CRON_UPDATES", `Lista optimizata: ${optimizedGames.length}/${games.length} jocuri folosite de guild-uri`);
    }

    let latestResults: UpdateFetchResult[];
    try {
      latestResults = await getLatestForAllGames(optimizedGames, shouldAbort);

      const allNull = latestResults.length > 0 && latestResults.every(result => result.latest == null);
      const realErrors = latestResults.filter(result => result.latest == null && result.error && result.error !== "abort");
      if (allNull && realErrors.length > 0) {
        throw new Error(`Toate cele ${latestResults.length} jocuri au intors latest: null (${realErrors.length} cu erori reale) — fetch esuat complet, snapshot-ul nu se persista (prima eroare: ${realErrors[0].error})`);
      }

      if (optimizedGames.length === games.length && !allNull) {
        setUpdatesCache(latestResults);
        if (persistFetchSnapshot) await persistFetchSnapshot("updates", latestResults).catch(() => undefined);
      }
    } catch (err: unknown) {
      const fallback = loadFetchSnapshot ? await loadFetchSnapshot("updates").catch(() => null) : null;
      const fresh = !!fallback && fallback.fetchedAt != null
        && (Date.now() - new Date(fallback.fetchedAt).getTime()) < SNAPSHOT_FALLBACK_MAX_AGE_MS;
      const isValidFetchResult = (item: unknown): item is UpdateFetchResult => validateUpdateFetchSnapshot(item);
      const fallbackResults = fresh && fallback && Array.isArray(fallback.payload)
        ? fallback.payload.filter(isValidFetchResult)
        : null;
      if (!fallbackResults || !fallbackResults.length) {
        throw new Error(`Nu am putut prelua update-urile si nu exista snapshot de rezerva proaspat: ${transientErrorMessage(err)}`);
      }
      logger("WARN", "CRON_UPDATES", "Fetch esuat — folosesc snapshot-ul recent din event store pentru dispatch", transientErrorMessage(err));
      latestResults = fallbackResults;
    }
    if (shouldAbort?.()) return;

    const dispatch = await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
      if (!shouldAbort?.()) await processGuildUpdates(client, guild, latestResults);
    }, {
      errorLogger: (guild: unknown, err: unknown) =>
        logger("WARN", "CRON_UPDATES", `Eroare procesare guild ${(guild as { _id?: unknown })._id}`, transientErrorMessage(err))
    });
    if (dispatch.processed === 0 && dispatch.errors.length > 0) {
      throw new Error(`Procesarea update-urilor a esuat pentru toate cele ${dispatch.errors.length} guild-uri abonate: ${transientErrorMessage(dispatch.errors[0]?.error)}`);
    }
  }

  return { processGuildUpdates, buildOptimizedGameList, checkForUpdates };
}
