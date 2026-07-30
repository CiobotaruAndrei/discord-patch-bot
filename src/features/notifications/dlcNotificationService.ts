"use strict";

import type { MongoWriteOutcome } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel.js";
import type { GameDlc, DlcSourceDeps, FetchGameDlcsOutcome } from "../command-handlers/dlcSourceService.js";
import { currencyToSteamCountry } from "../command-handlers/dlcSourceService.js";
import type { NotificationEmbed } from "./notificationTypes.js";
import { planDlcCandidates, buildDlcEmbed, collectBaselineDlcEntries, type DlcCandidate } from "./dlcNotificationPlanner.js";
import { sendEmbedBatch } from "./notificationBatchExecutor.js";
import { rollbackOrReport, type ReportRollbackFailure } from "./rollbackReporter.js";
import { claimIntoBatch } from "./notificationCycle.js";

const DISCORD_EMBEDS_PER_MESSAGE = 10;
const CANDIDATE_SAFETY_LIMIT = 1000;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type MongoWriteResult = MongoWriteOutcome;

interface DlcGuildDoc {
  _id: string | number;
  dlcChannelId?: string | null;
}

interface GuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<DlcGuildDoc[]> };
}

type ResolveOutboundChannel = (opts: {
  client: NotificationDiscordClient;
  guild: DlcGuildDoc;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolveOutboundChannelResult>;

interface RunConcurrentResult {
  processed: number;
  errors: Array<{ error: unknown }>;
}
type RunConcurrent = <T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>, opts?: { errorLogger?: (item: T, err: unknown) => void }) => Promise<RunConcurrentResult>;

export interface DlcNotificationServiceDeps {
  GuildModel: GuildModelLike;
  logger: Logger;
  runConcurrent: RunConcurrent;
  resolveOutboundChannel: ResolveOutboundChannel;
  claimSeenDlc: (guildId: string, channelId: string, gameKey: string, dlcKey: string) => Promise<MongoWriteResult>;
  rollbackSeenDlc: (guildId: string, gameKey: string, dlcKey: string) => Promise<MongoWriteResult>;
  seedSeenDlcs: (guildId: string, entries: Array<{ gameKey: string; dlcKey: string }>) => Promise<void>;
  disableDlcForChannelError: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
  reportRollbackFailure?: ReportRollbackFailure;
  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;
  fetchGameDlcs: (deps: DlcSourceDeps, appId: string | number, currencyCode?: string) => Promise<FetchGameDlcsOutcome>;
  dlcSource: DlcSourceDeps;
  sleepIfPositive: (ms: number) => Promise<void>;
  DEFAULT_CURRENCY: string;
  DLC_EMBED_COLOR?: number;
  MAX_DLCS_PER_CYCLE: number;
  DLC_FETCH_CONCURRENCY: number;
  DISCORD_SEND_DELAY_MS: number;
  GUILD_PROCESS_CONCURRENCY: number;
}

export interface DlcNotificationService {
  processGuildDlcs(client: NotificationDiscordClient, guild: DlcGuildDoc, games: GameConfig[], dlcsByGame: Map<string, GameDlc[]>): Promise<void>;
  checkForDlcs(client: NotificationDiscordClient, games: GameConfig[], shouldAbort?: (() => boolean) | null): Promise<void>;
  seedBaselineDlc(guildId: string, games: GameConfig[]): Promise<void>;
}

export function createDlcNotificationService(deps: DlcNotificationServiceDeps): DlcNotificationService {
  const {
    GuildModel, logger, runConcurrent, resolveOutboundChannel,
    claimSeenDlc, rollbackSeenDlc, seedSeenDlcs, disableDlcForChannelError, reportRollbackFailure,
    isPermanentDiscordError, transientErrorMessage,
    fetchGameDlcs, dlcSource, sleepIfPositive,
    DEFAULT_CURRENCY, DLC_EMBED_COLOR, MAX_DLCS_PER_CYCLE, DLC_FETCH_CONCURRENCY,
    DISCORD_SEND_DELAY_MS, GUILD_PROCESS_CONCURRENCY
  } = deps;

  async function fetchAllGameDlcs(games: GameConfig[], options?: { shouldAbort?: (() => boolean) | null; requireAll?: boolean }): Promise<Map<string, GameDlc[]>> {
    const dlcsByGame = new Map<string, GameDlc[]>();
    const fetchable = games.filter(game => Boolean(game && game.key && game.appId != null && String(game.appId).trim()));
    if (!fetchable.length) return dlcsByGame;
    const country = currencyToSteamCountry(DEFAULT_CURRENCY);
    const failures: string[] = [];
    await runConcurrent(fetchable, Math.max(1, DLC_FETCH_CONCURRENCY), async (game) => {
      if (options?.shouldAbort?.()) return;
      const outcome = await fetchGameDlcs(dlcSource, String(game.appId), country);
      if (outcome.status === "ok") {
        if (outcome.dlcs.length) dlcsByGame.set(String(game.key), outcome.dlcs);
      } else {
        failures.push(`${game.key}:${outcome.status}`);
        logger("WARN", "CRON_DLC", `Sursa DLC pentru ${game.key} a raspuns cu status ${outcome.status}`);
      }
    }, {
      errorLogger: (game, err) => {
        failures.push(`${game.key}:error`);
        logger("WARN", "CRON_DLC", `Eroare la preluarea DLC pentru ${game.key}`, transientErrorMessage(err));
      }
    });
    if (options?.requireAll && failures.length > 0) {
      throw new Error(`baseline DLC incomplet: ${failures.length} surse obligatorii neconfirmate (${failures.slice(0, 5).join(", ")})`);
    }
    return dlcsByGame;
  }

  async function processGuildDlcs(client: NotificationDiscordClient, guild: DlcGuildDoc, games: GameConfig[], dlcsByGame: Map<string, GameDlc[]>): Promise<void> {
    const guildId = String(guild._id);
    const resolved = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.dlcChannelId,
      context: "CRON_DLC",
      disableFn: disableDlcForChannelError
    });
    if (resolved.abort) return;
    const channel = resolved.channel;

    const candidates = planDlcCandidates(games, dlcsByGame, CANDIDATE_SAFETY_LIMIT);
    if (!candidates.length) return;

    const rollbackContext = (candidate: DlcCandidate) => ({
      guildId,
      kind: "dlc",
      itemId: `${candidate.gameKey}:${candidate.dlc.dlcKey}`
    });

    const claimed = await claimIntoBatch<DlcCandidate, { candidate: DlcCandidate; embed: NotificationEmbed }>({
      candidates,
      limit: MAX_DLCS_PER_CYCLE,
      context: "CRON_DLC",
      logger,
      claim: candidate => claimSeenDlc(guildId, channel.id, candidate.gameKey, candidate.dlc.dlcKey),
      prepare: candidate => ({ candidate, embed: buildDlcEmbed(candidate, DLC_EMBED_COLOR) }),
      rollback: candidate => rollbackOrReport(
        () => rollbackSeenDlc(guildId, candidate.gameKey, candidate.dlc.dlcKey),
        logger,
        rollbackContext(candidate),
        reportRollbackFailure
      ),
      describe: candidate => `DLC ${candidate.dlc.dlcKey} pentru ${candidate.gameKey}`,
      isPermanentError: isPermanentDiscordError,
      onPermanentError: async err => {
        const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
        await disableDlcForChannelError(guildId, channel.id, reason).catch(() => null);
        logger("WARN", "CRON_DLC", `Notificarile DLC oprite pentru guild ${guildId} - cod permanent`, reason);
      },
      errorMessage: transientErrorMessage
    });
    if (claimed.stopped) return;
    const batch = claimed.batch;
    if (!batch.length) return;

    await sendEmbedBatch({
      channel,
      batch,
      embedOf: entry => entry.embed,
      historyEntryFor: entry => ({
        kind: "dlc" as const,
        gameKey: entry.candidate.gameKey,
        title: `DLC nou: ${entry.candidate.dlc.name}`,
        link: entry.candidate.appId ? `https://store.steampowered.com/app/${entry.candidate.appId}` : "",
        itemId: `${entry.candidate.gameKey}:${entry.candidate.dlc.dlcKey}`
      }),
      messageTemplate: null,
      roleId: null,
      maxEmbedsPerMessage: DISCORD_EMBEDS_PER_MESSAGE,
      sendDelayMs: DISCORD_SEND_DELAY_MS,
      sleepIfPositive,
      isPermanentDiscordError,
      transientErrorMessage,
      rollbackEntry: entry => rollbackSeenDlc(guildId, entry.candidate.gameKey, entry.candidate.dlc.dlcKey),
      rollbackFailureContext: entry => rollbackContext(entry.candidate),
      reportRollbackFailure,
      logger,
      onPermanentError: async reason => {
        await disableDlcForChannelError(guildId, channel.id, reason).catch(() => null);
        logger("WARN", "CRON_DLC", `Notificarile DLC oprite pentru guild ${guildId} - cod permanent`, reason);
      },
      onTransientFailure: (_failed, err) => {
        logger("WARN", "CRON_DLC", "Nu am putut trimite notificarile DLC", transientErrorMessage(err));
      }
    });
  }

  async function checkForDlcs(client: NotificationDiscordClient, games: GameConfig[], shouldAbort: (() => boolean) | null = null): Promise<void> {
    if (shouldAbort?.()) return;
    const guilds = await GuildModel.find({
      dlcSubscribed: true,
      dlcChannelId: { $ne: null },
      dlcInitializing: { $ne: true }
    }).lean();
    if (!guilds.length) return;

    const dlcsByGame = await fetchAllGameDlcs(games, { shouldAbort });
    if (!dlcsByGame.size) return;

    await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
      if (shouldAbort?.()) return;
      await processGuildDlcs(client, guild, games, dlcsByGame);
    }, {
      errorLogger: (guild, err) => logger("WARN", "CRON_DLC", `Eroare la procesarea guild-ului ${guild._id}`, transientErrorMessage(err))
    });
  }

  async function seedBaselineDlc(guildId: string, games: GameConfig[]): Promise<void> {
    const dlcsByGame = await fetchAllGameDlcs(games, { requireAll: true });
    const entries = collectBaselineDlcEntries(games, dlcsByGame);
    if (entries.length) await seedSeenDlcs(guildId, entries);
  }

  return { processGuildDlcs, checkForDlcs, seedBaselineDlc };
}
