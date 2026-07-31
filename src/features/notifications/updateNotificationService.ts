"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { RunConcurrent } from "../../shared/concurrencyPort.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import type { NotificationMode } from "../../features/notifications/notificationTypes.js";
import type { EmbeddableUpdate } from "../../sources/sourceTypes.js";
type MongoUpdate = Record<string, unknown>;
import type { MongoWriteOutcome } from "../../types.js";
import { buildPendingUpdatesQueue, PendingUpdate, UpdateFetchResult } from "./pendingUpdatesQueue.js";
import type { NotificationEmbed } from "./notificationTypes.js";
import { buildDeadLetterEntry, DeadLetterEntry } from "./deadLetter.js";
import type { DeadLetterModelLike } from "./deadLetterRepository.js";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel.js";
import { HASH_VERSION } from "../../native/fuzzy.js";
import { persistGuildCycleState } from "./notificationCycleRepository.js";
import { planPendingFailure, planRebaselineEntries, requeueFront, takeNextPending } from "./updateNotificationPlanner.js";
import type { ReportRollbackFailure } from "./rollbackReporter.js";
import { loadNotificationFeed } from "./notificationFeedLoader.js";
import { runGuildNotificationCycle, type NotificationCycleEnvironment } from "./notificationCycle.js";
import { cronContextFor, subscriptionFilterFor, type NotificationKind } from "../../shared/notificationKinds.js";

const NOTIFICATION_KIND: NotificationKind = "update";
const CRON_CONTEXT = cronContextFor(NOTIFICATION_KIND);
const DISCORD_EMBEDS_PER_MESSAGE = 10;
const SNAPSHOT_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

type MongoWriteResult = MongoWriteOutcome;
type GuildGameFilter = Pick<GuildSettings, "enabledGames">;
type GuildSettingsDoc = GuildSettings;

interface GuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<GuildSettingsDoc[]> };
  updateOne(filter: Record<string, unknown>, update: MongoUpdate): Promise<MongoWriteResult>;
}

type ResolveOutboundChannel = (opts: {
  client: NotificationDiscordClient;
  guild: GuildSettings;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolveOutboundChannelResult>;

export interface UpdateNotificationServiceDeps {
  GuildModel: GuildModelLike;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "insertMany" | "find" | "deleteMany">;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;

  claimSeenUpdate: (guildId: string, channelId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  rollbackSeenUpdate: (guildId: string, gameKey: string, updateId: string) => Promise<MongoWriteResult>;
  seedSeenUpdates: (guildId: string, entries: Array<{ gameKey: string; updateId: string }>) => Promise<void>;
  setSeenHashVersion: (guildId: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number) => Promise<MongoWriteResult>;
  disableUpdatesForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
  reportRollbackFailure?: ReportRollbackFailure;

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
  buildUpdateEmbed: (gameName: string, latest: EmbeddableUpdate, mode: NotificationMode) => NotificationEmbed;

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
    GuildModel, GuildDeadLetterModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenUpdate, rollbackSeenUpdate, seedSeenUpdates, setSeenHashVersion, disableUpdatesForChannelError, reportRollbackFailure,
    isPermanentDiscordError, transientErrorMessage,
    normalizePendingUpdateArray, toEntries, rotateAfter, mapToObject,
    getLatestForAllGames, validateUpdateFetchSnapshot, setUpdatesCache, persistFetchSnapshot, loadFetchSnapshot, buildUpdateEmbed, sleepIfPositive,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT, MAX_UPDATES_PER_CYCLE,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  } = deps;

  const cycleEnvironment: NotificationCycleEnvironment = {
    logger, isPermanentDiscordError, transientErrorMessage, sleepIfPositive, reportRollbackFailure,
    maxEmbedsPerMessage: DISCORD_EMBEDS_PER_MESSAGE,
    sendDelayMs: DISCORD_SEND_DELAY_MS
  };

  async function processGuildUpdates(
    client: NotificationDiscordClient,
    guild: GuildSettingsDoc,
    latestResults: UpdateFetchResult[]
  ): Promise<void> {
    const { channel, abort } = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.notificationChannelId,
      context: CRON_CONTEXT,
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
      logger("INFO", CRON_CONTEXT, `Re-baseline dedup update-uri pentru guild ${guild._id} (hashVersion -> ${HASH_VERSION}); ciclul curent nu trimite notificari`);
      return;
    }

    const notificationMode: NotificationMode = guild.notificationMode === "compact" ? "compact" : "detailed";
    type UpdateSelection = { gameKey: string; item: PendingUpdate };
    let lastProcessedGameKey: string | null = guild.lastProcessedGameKey || null;

    function requeueOrDeadLetter(selection: UpdateSelection, err: unknown): void {
      const failure = planPendingFailure(selection.item, PENDING_UPDATE_MAX_ATTEMPTS);
      if (failure.action === "requeue") {
        requeueFront(pendingByGame, selection.gameKey, selection.item);
      } else {
        deadLettered.push(buildDeadLetterEntry({
          kind: NOTIFICATION_KIND, itemId: selection.item.id, title: selection.item.title,
          reason: transientErrorMessage(err), attempts: failure.attempts
        }));
      }
    }

    await runGuildNotificationCycle<UpdateSelection>(cycleEnvironment, {
      kind: NOTIFICATION_KIND,
      guildId: String(guild._id),
      channel,
      limit: MAX_UPDATES_PER_CYCLE,
      pull: () => {
        const selection = takeNextPending(pendingByGame, lastProcessedGameKey, rotateAfter);
        if (!selection) return null;
        lastProcessedGameKey = selection.gameKey;
        return { gameKey: selection.gameKey, item: selection.item };
      },
      identify: selection => ({
        itemId: `${selection.gameKey}:${selection.item.id}`,
        describe: `update-ul ${selection.gameKey}/${selection.item.id}`,
        history: {
          gameKey: selection.gameKey,
          title: selection.item.title || "",
          link: selection.item.link || "",
          itemId: selection.item.id
        }
      }),
      claim: selection => claimSeenUpdate(String(guild._id), channel.id, selection.gameKey, selection.item.id),
      buildEmbed: selection => {
        const game = resultByGameKey.get(selection.gameKey)?.game || { name: selection.gameKey, key: selection.gameKey };
        return buildUpdateEmbed(game.name, selection.item, notificationMode);
      },
      releaseClaim: selection => rollbackSeenUpdate(String(guild._id), selection.gameKey, selection.item.id),
      disableChannel: reason => disableUpdatesForChannelError(String(guild._id), channel.id, reason),
      claimFailureIsPermanent: () => false,
      onClaimFailure: (selection, err) => {
        requeueOrDeadLetter(selection, err);
        logger("WARN", CRON_CONTEXT, `buildUpdateEmbed a esuat pentru ${selection.gameKey}/${selection.item.id}; claim-ul a fost dat inapoi`, transientErrorMessage(err));
      },
      onSendFailure: (failed, err) => {
        for (let j = failed.length - 1; j >= 0; j--) requeueOrDeadLetter(failed[j], err);
      },
      messageTemplate: guild.updateMessageTemplate,
      roleId: guild.notificationRoleId,
      persist: async () => {
        const setDoc: Record<string, unknown> = { pendingUpdates: mapToObject(pendingByGame) };
        if (lastProcessedGameKey) setDoc.lastProcessedGameKey = lastProcessedGameKey;
        await persistGuildCycleState(
          GuildModel, GuildDeadLetterModel, String(guild._id),
          subscriptionFilterFor({ kind: NOTIFICATION_KIND, guildId: String(guild._id), channelId: channel.id }),
          setDoc, deadLettered
        );
      }
    });
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
      logger("INFO", CRON_CONTEXT, `Lista optimizata: ${optimizedGames.length}/${games.length} jocuri folosite de guild-uri`);
    }

    const isValidFetchResult = (item: unknown): item is UpdateFetchResult => validateUpdateFetchSnapshot(item);
    const latestResults = await loadNotificationFeed({
      snapshotId: "updates",
      fetchFresh: async () => {
        const results = await getLatestForAllGames(optimizedGames, shouldAbort);
        const allNull = results.length > 0 && results.every(result => result.latest == null);
        const realErrors = results.filter(result => result.latest == null && result.error && result.error !== "abort");
        if (allNull && realErrors.length > 0) {
          throw new Error(`Toate cele ${results.length} jocuri au intors latest: null (${realErrors.length} cu erori reale); fetch esuat complet, snapshot-ul nu se persista (prima eroare: ${realErrors[0].error})`);
        }
        return results;
      },
      validateItem: isValidFetchResult,
      persistFresh: async results => {
        const allNull = results.length > 0 && results.every(result => result.latest == null);
        if (optimizedGames.length !== games.length || allNull) return;
        setUpdatesCache(results);
        if (persistFetchSnapshot) await persistFetchSnapshot("updates", results).catch(() => undefined);
      },
      loadSnapshot: loadFetchSnapshot,
      maxSnapshotAgeMs: SNAPSHOT_FALLBACK_MAX_AGE_MS,
      invalidSnapshotItemPolicy: "reject-snapshot",
      onFallback: error => logger("WARN", CRON_CONTEXT, "Fetch esuat; folosesc snapshot-ul recent din event store pentru dispatch", transientErrorMessage(error)),
      createUnavailableError: error => new Error(`Nu am putut prelua update-urile si nu exista snapshot de rezerva proaspat: ${transientErrorMessage(error)}`)
    });
    if (shouldAbort?.()) return;

    const dispatch = await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
      if (!shouldAbort?.()) await processGuildUpdates(client, guild, latestResults);
    }, {
      errorLogger: (guild, err) =>
        logger("WARN", CRON_CONTEXT, `Eroare procesare guild ${guild._id}`, transientErrorMessage(err))
    });
    if (dispatch.processed === 0 && dispatch.errors.length > 0) {
      throw new Error(`Procesarea update-urilor a esuat pentru toate cele ${dispatch.errors.length} guild-uri abonate: ${transientErrorMessage(dispatch.errors[0]?.error)}`);
    }
  }

  return { processGuildUpdates, buildOptimizedGameList, checkForUpdates };
}
