"use strict";

import type {
  ChatInputInteraction,
  IntegerOption,
  InteractionGuildRef,
  NumberOption,
  OptionalSubcommandGroupOption,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { CheerioAPI } from "cheerio";
import type { PriceValue } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { DealInfo, SteamReviewData } from "../../sources/sourceTypes.js";
import type { SteamAppDetailsSummary, SteamCurrentPlayersSummary, SteamLatestUpdateSizeSummary } from "../../sources/sourceApis.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import type { DiscordEmbed } from "./gameInfoEmbeds.js";
import {
  buildBestDealsEmbed,
  buildCoopEmbed,
  buildCrossplayEmbed,
  buildEndingDealsEmbed,
  buildGameSizeEmbed,
  buildPlatformsEmbed,
  buildPlayerCountEmbed,
  buildReviewTrendEmbed,
  buildSystemRequirementsEmbed,
  buildTopActiveGamesEmbed,
  clampResultLimit,
  extractInstallSize,
  findExternalStores,
  selectTopActiveGames
} from "./gameInfoEmbeds.js";
import { createGameInfoLookupService } from "./gameInfoLookupService.js";
import { calculatePlayerCountStats } from "../player-count/playerCountTimeAnalysis.js";
import type { PlayerCountHistoryPoint } from "../player-count/playerCountSnapshotService.js";
import { analyzeReviewTrend } from "../game-info/reviewTrendAnalysis.js";
import { selectHistoricalReviewSnapshot, type StoredReviewSnapshot } from "../game-info/reviewTrendSnapshotService.js";

import { errorMessage } from "../../shared/errors.js";
import ________shared_utilities from "../../shared/utilities.js";
const { mapWithConcurrency } = ________shared_utilities;

type MaybePromise<T> = T | Promise<T>;
type Logger = (level: string, context: string, message: string, meta?: Record<string, string | number | boolean | null>) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, string | number | boolean | null>) => void;
type SteamSearchCandidate = { id?: string | number; name?: string };

type InteractionReplyPayload = string | {
  content?: string;
  embeds?: DiscordEmbed[];
  flags?: number;
};

type DiscordInteraction = ChatInputInteraction<
  SubcommandOption & OptionalSubcommandGroupOption & StringOption & NumberOption & IntegerOption,
  InteractionGuildRef,
  InteractionReplyPayload
>;

interface GameInfoDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, string | number | boolean | null>) => CommandLogEnd;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionReplyPayload): Promise<object | null>;
  searchSteamGameByName(query: string, currency: string): Promise<SteamSearchCandidate[]>;
  chooseBestSteamMatch(items: SteamSearchCandidate[], query: string, options?: { forceGameOnly?: boolean }): SteamSearchCandidate | null;
  fetchSteamPriceDetails(appId: string | number, currency: string): Promise<SteamAppDetailsSummary | null>;
  fetchSteamCurrentPlayers(appId: string | number): Promise<SteamCurrentPlayersSummary>;
  fetchSteamLatestUpdateSize(appId: string | number): Promise<SteamLatestUpdateSizeSummary>;
  readPlayerCountSnapshots?(appIds: readonly (string | number)[]): Promise<Map<string, { appId: string; gameKey: string; playerCount: number; fetchedAt: Date }>>;
  readPlayerCountHistory?(appIds: readonly (string | number)[], since: Date): Promise<PlayerCountHistoryPoint[]>;
  fetchSteamReviewData(appId: string | number): Promise<SteamReviewData>;
  recordReviewTrendSnapshot?(appId: string | number, gameKey: string, review: SteamReviewData, at?: Date): Promise<boolean>;
  readReviewTrendHistory?(appId: string | number, since: Date): Promise<StoredReviewSnapshot[]>;
  getDealsCacheData(currency: string): DealInfo[] | null;
  setDealsCache(currency: string, deals: DealInfo[]): void;
  fetchDeals(opts: { currency: string }): Promise<DealInfo[]>;
  enrichDealData(deal: DealInfo, currency?: string): Promise<DealInfo>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  formatPrice(value: PriceValue, currencyCode?: string | null): string;
  safeCheerioLoad(html: string): CheerioAPI;
  DEFAULT_CURRENCY: string;
  MessageFlags: { Ephemeral: number };
}

type GameInfoContext = GameInfoDeps;

const GAME_INFO_COMMANDS = new Set(["best", "ending", "review-trend", "crossplay", "platforms", "co-op", "system", "game-size", "player-count", "top"]);
const TOP_ACTIVE_PLAYER_COUNT_CONCURRENCY = 5;
const TOP_ACTIVE_CANDIDATE_CAP = 25;

function createGameInfoInteractionHandler(deps: GameInfoDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit,
    fetchSteamReviewData, fetchSteamCurrentPlayers
  } = deps;

  const lookup = createGameInfoLookupService(deps);

  async function resolveCurrency(interaction: DiscordInteraction): Promise<string> {
    return lookup.resolveCurrency(interaction.options.getString("currency", false), interaction.guild?.id ?? null);
  }

  async function handleDealsCommand(interaction: DiscordInteraction): Promise<object | void | null> {
    const command = interaction.commandName || "";
    const currency = await resolveCurrency(interaction);
    const limit = clampResultLimit(interaction.options.getInteger("numar", false));
    const deals = await lookup.loadDeals(currency);
    if (command === "best") {
      const budget = interaction.options.getNumber("buget", true);
      if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
        return safeEdit(interaction, "Eroare: `buget` trebuie sa fie un numar pozitiv.");
      }
      return safeEdit(interaction, { embeds: [buildBestDealsEmbed(deals, budget, currency, limit, deps.formatPrice)] });
    }
    return safeEdit(interaction, { embeds: [await buildEndingDealsEmbed(deps, deals, currency, limit)] });
  }

  async function handleSteamInfoCommand(interaction: DiscordInteraction): Promise<object | void | null> {
    const query = String(interaction.options.getString("game", true) || "").trim();
    if (!query) return safeEdit(interaction, "Eroare: trebuie sa specifici jocul.");
    const currency = await resolveCurrency(interaction);
    const resolved = await lookup.resolveSteam(query, currency);
    if (!resolved) return safeEdit(interaction, `Eroare: nu am gasit jocul \`${query}\` pe Steam.`);
    const { appId, details } = resolved;
    if (interaction.commandName === "review-trend") {
      const review = await fetchSteamReviewData(appId);
      const now = new Date();
      const history = deps.readReviewTrendHistory
        ? await deps.readReviewTrendHistory(appId, new Date(now.getTime() - 15 * 86_400_000)).catch(() => [])
        : [];
      const older = selectHistoricalReviewSnapshot(history, now);
      const recent = review.success ? { totalReviews: review.totalReviews, qualityPercent: review.qualityPercent, at: now } : null;
      const analysis = analyzeReviewTrend(older, recent);
      if (deps.recordReviewTrendSnapshot) {
        await deps.recordReviewTrendSnapshot(appId, query, review, now).catch(() => false);
      }
      return safeEdit(interaction, { embeds: [buildReviewTrendEmbed(query, appId, details, review, analysis)] });
    }
    if (interaction.commandName === "crossplay") return safeEdit(interaction, { embeds: [buildCrossplayEmbed(query, appId, details)] });
    if (interaction.commandName === "co-op") return safeEdit(interaction, { embeds: [buildCoopEmbed(query, appId, details)] });
    if (interaction.commandName === "system") return safeEdit(interaction, { embeds: [buildSystemRequirementsEmbed(query, appId, details, deps.safeCheerioLoad)] });
    if (interaction.commandName === "game-size") {
      const latestUpdate = await deps.fetchSteamLatestUpdateSize(appId).catch(() => ({ size: null, title: null, publishedAt: null, sourceUrl: null }));
      return safeEdit(interaction, { embeds: [buildGameSizeEmbed(query, appId, details, deps.safeCheerioLoad, latestUpdate)] });
    }
    if (interaction.commandName === "player-count") {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 60 * 60_000);
      const fresh = await lookup.readFreshSnapshots([String(appId)]);
      const snapshot = fresh.get(String(appId));
      const players = snapshot
        ? { appId: String(appId), playerCount: snapshot.playerCount, success: true }
        : await fetchSteamCurrentPlayers(appId);
      const history = deps.readPlayerCountHistory
        ? await deps.readPlayerCountHistory([String(appId)], from).catch(() => [])
        : [];
      const stats = calculatePlayerCountStats(history, { from, to });
      return safeEdit(interaction, { embeds: [buildPlayerCountEmbed(query, appId, details, players, stats)] });
    }
    const deals = await lookup.loadDeals(currency).catch(() => []);
    return safeEdit(interaction, { embeds: [buildPlatformsEmbed(query, appId, details, findExternalStores(deals, query, details.name || query, appId))] });
  }

  async function handleTopActiveCommand(interaction: DiscordInteraction, games: GameConfig[]): Promise<object | void | null> {
    const limit = clampResultLimit(interaction.options.getInteger("numar", false));
    const selectedGames = selectTopActiveGames(games);
    if (!selectedGames.length) {
      return safeEdit(interaction, "Eroare: nu am jocuri cunoscute cu Steam appId pentru player-count.");
    }
    const fresh = await lookup.readFreshSnapshots(selectedGames.map(game => String(game.appId)));
    const snapshotItems: Array<{ game: GameConfig; players: SteamCurrentPlayersSummary }> = [];
    const missing: GameConfig[] = [];
    for (const game of selectedGames) {
      const appId = String(game.appId);
      const snapshot = fresh.get(appId);
      if (snapshot) {
        snapshotItems.push({ game, players: { appId, playerCount: snapshot.playerCount, success: true } });
      } else {
        missing.push(game);
      }
    }
    const toFetch = missing.slice(0, TOP_ACTIVE_CANDIDATE_CAP);
    const liveItems = await mapWithConcurrency(toFetch, TOP_ACTIVE_PLAYER_COUNT_CONCURRENCY, async game => {
      const appId = String(game.appId);
      try {
        return { game, players: await fetchSteamCurrentPlayers(appId) };
      } catch (err) {
        deps.logger("WARN", "GAME_INFO", "Player count Steam esuat pentru un joc din top", { appId, error: errorMessage(err) });
        return { game, players: { appId, playerCount: 0, success: false } };
      }
    });
    const notChecked = Math.max(0, missing.length - toFetch.length);
    const playerCounts = [...snapshotItems, ...liveItems];
    return safeEdit(interaction, { embeds: [buildTopActiveGamesEmbed(playerCounts, limit, notChecked)] });
  }

  async function handleGameInfo(interaction: DiscordInteraction, games: GameConfig[] = []): Promise<object | void | null> {
    const command = interaction.commandName || "";
    if (!(await enforceCooldown(interaction, command))) return undefined;
    const endLog = startCommandLog(interaction, command);
    await safeDefer(interaction);
    try {
      const result = command === "best" || command === "ending"
        ? await handleDealsCommand(interaction)
        : command === "top"
          ? await handleTopActiveCommand(interaction, games)
        : await handleSteamInfoCommand(interaction);
      endLog("ok");
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger("WARN", "GAME_INFO", `Eroare la /${command}`, { errorMsg: msg });
      endLog("error", { errorMsg: msg });
      return safeEdit(interaction, `Eroare: nu am putut procesa comanda acum: ${errorMessage(err)}`);
    }
  }

  return { handleGameInfo };
}

function isGameInfoCommand(interaction: Parameters<CommandHandler["canHandle"]>[0]): interaction is DiscordInteraction {
  if (typeof interaction !== "object" || interaction === null) return false;
  const commandName = Reflect.get(interaction, "commandName");
  const isChatInputCommand = Reflect.get(interaction, "isChatInputCommand");
  const guild = Reflect.get(interaction, "guild");
  const options = Reflect.get(interaction, "options");
  const subcommand = commandName === "player-count" && options && typeof options === "object" && typeof Reflect.get(options, "getSubcommand") === "function"
    ? String(Reflect.get(options, "getSubcommand").call(options, false) || "")
    : "";
  return typeof commandName === "string"
    && GAME_INFO_COMMANDS.has(commandName)
    && (commandName !== "player-count" || subcommand === "game")
    && typeof isChatInputCommand === "function"
    && isChatInputCommand.call(interaction) === true
    && Boolean(guild);
}

function buildGameInfoCommandHandler(target: GameInfoContext) {
  const handlers = createGameInfoInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: isGameInfoCommand,
    handle: async (interaction, games) => {
      try {
        return await handlers.handleGameInfo(interaction, games);
      } catch (err) {
        target.logger("ERROR", "GAME_INFO", "Eroare neasteptata in handler-ul de game info", { errorMsg: err instanceof Error ? err.message : String(err) });
        const payload = { content: "Eroare: nu am putut procesa comanda.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") await interaction.followUp(payload);
          else if (typeof interaction.reply === "function") await interaction.reply(payload);
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createGameInfoInteractionHandler,
  buildBestDealsEmbed,
  buildEndingDealsEmbed,
  buildReviewTrendEmbed,
  buildCrossplayEmbed,
  buildPlatformsEmbed,
  buildCoopEmbed,
  buildSystemRequirementsEmbed,
  buildGameSizeEmbed,
  buildPlayerCountEmbed,
  buildTopActiveGamesEmbed,
  selectTopActiveGames,
  extractInstallSize,
  buildCommandHandler: buildGameInfoCommandHandler
};
