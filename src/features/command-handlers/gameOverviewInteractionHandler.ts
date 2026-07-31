"use strict";

import type {
  ChatInputInteraction,
  StringOption
} from "./discordInteractionPorts.js";
import type { CheerioAPI } from "cheerio";
import type { PriceValue } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { DealInfo, FetchResult } from "../../sources/sourceTypes.js";
import type { GameServerStatus } from "../command-presentation/gameStatusEmbeds.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { findBestDeal, scoreDeal } from "./dealScoreInteractionHandler.js";
import { dlcPageHasAgeGate, parseDlcRows } from "./dlcSteamPage.js";
import { errorDetail } from "../../shared/errors.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type DiscordInteraction = ChatInputInteraction<StringOption>;

interface GameOverviewDeps {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  findGameAndSuggestion(query: string, games: GameConfig[]): { game: GameConfig | null; suggestion: GameConfig | null };
  executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult>;
  getDealsCacheData(currency: string): DealInfo[] | null;
  setDealsCache(currency: string, deals: DealInfo[]): void;
  fetchDeals(options: { currency: string }): Promise<DealInfo[]>;
  fetchSteamCurrentPlayers(appId: string | number): Promise<{ playerCount: number; success: boolean }>;
  fetchGameStatusSummary(game: GameConfig): Promise<GameServerStatus>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  getCurrencyConfig(code?: string): { cc: string };
  formatPrice(value: PriceValue, currencyCode?: string | null): string;
  httpReq(method: string, url: string, options?: Record<string, unknown>): Promise<{ data: unknown }>;
  safeCheerioLoad(html: unknown): CheerioAPI;
  DEFAULT_CURRENCY: string;
  MessageFlags: { Ephemeral: number };
}

function unavailable(reason = "Indisponibil"): string {
  return `⚪ ${reason}`;
}

function dealPrice(deal: DealInfo, deps: GameOverviewDeps, currency: string): string {
  const numeric = Number(deal.salePrice);
  return Number.isFinite(numeric) ? deps.formatPrice(numeric, String(deal.currency || currency)) : String(deal.salePrice || "indisponibil");
}

function createGameOverviewHandler(deps: GameOverviewDeps) {
  async function loadDeals(currency: string): Promise<DealInfo[]> {
    const cached = deps.getDealsCacheData(currency);
    if (cached) return cached;
    const deals = await deps.fetchDeals({ currency });
    deps.setDealsCache(currency, deals);
    return deals;
  }

  async function loadDlc(game: GameConfig, currency: string): Promise<string[]> {
    if (!game.appId) return [];
    const cc = deps.getCurrencyConfig(currency).cc;
    const response = await deps.httpReq("GET", `https://store.steampowered.com/app/${game.appId}?cc=${cc}&l=english`, {
      headers: { Cookie: "birthtime=283993201; mature_content=1;" },
      timeout: 15000
    });
    const page = deps.safeCheerioLoad(response.data);
    if (dlcPageHasAgeGate(page)) return [];
    return parseDlcRows(page).slice(0, 3).map(item => `${item.name} — ${item.price}`);
  }

  async function handle(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const query = String(interaction.options.getString("joc", true) || "").trim();
    if (!query) return interaction.reply?.({ content: "Eroare: trebuie sa specifici jocul.", flags: deps.MessageFlags.Ephemeral });
    if (!(await deps.enforceCooldown(interaction, "game overview"))) return undefined;
    await deps.safeDefer(interaction);
    const { game, suggestion } = deps.findGameAndSuggestion(query, games);
    if (!game) return deps.safeEdit(interaction, suggestion ? `Nu am gasit jocul. Te refereai la **${suggestion.name}**?` : "Nu am gasit jocul.");
    const settings = interaction.guild?.id ? await deps.getGuildSettings(interaction.guild.id) : null;
    const currency = String(settings?.currency || deps.DEFAULT_CURRENCY);
    const results = await Promise.allSettled([
      deps.executeFetchWithCircuitBreaker(game),
      loadDeals(currency),
      game.appId ? deps.fetchSteamCurrentPlayers(String(game.appId)) : Promise.resolve(null),
      deps.fetchGameStatusSummary(game),
      loadDlc(game, currency)
    ]);
    const update = results[0].status === "fulfilled" ? results[0].value : null;
    const deals = results[1].status === "fulfilled" ? results[1].value : [];
    const players = results[2].status === "fulfilled" ? results[2].value : null;
    const serverStatus = results[3].status === "fulfilled" ? results[3].value : null;
    const dlc = results[4].status === "fulfilled" ? results[4].value : [];
    const deal = findBestDeal(deals, game.name);
    const scored = deal ? scoreDeal(deal) : null;
    const watched = !Array.isArray(settings?.enabledGames) || settings.enabledGames.length === 0 || settings.enabledGames.includes(game.key);
    const updateText = update?.latest
      ? `[${String(update.latest.title || "Ultimul update")}](${String(update.latest.link || game.url || "")})`
      : unavailable(update?.error ? "Sursa de update a esuat" : "Fara update disponibil");
    const dealText = deal
      ? `**${deal.title || game.name}** — ${dealPrice(deal, deps, currency)} la ${deal.store || "magazin necunoscut"}`
      : unavailable("Fara oferta activa");
    const playerText = players?.success ? `🟢 ${players.playerCount.toLocaleString("en-US")} jucatori activi` : unavailable(game.appId ? "Player count indisponibil" : "Fara Steam appId");
    const statusText = serverStatus ? `${serverStatus.state === "online" ? "🟢" : serverStatus.state === "unknown" ? "⚪" : "🟠"} ${serverStatus.label}` : unavailable("Status indisponibil");
    return deps.safeEdit(interaction, {
      embeds: [{
        title: `Game overview: ${game.name}`,
        color: 0x5865f2,
        thumbnail: game.thumbnail ? { url: game.thumbnail } : undefined,
        fields: [
          { name: "Ultimul update", value: updateText, inline: false },
          { name: "Cea mai buna oferta", value: dealText, inline: false },
          { name: "Deal score", value: scored ? `**${scored.score}/10** — ${scored.reasons.join(", ")}` : unavailable(), inline: false },
          { name: "Player count", value: playerText, inline: true },
          { name: "Server status", value: statusText, inline: true },
          { name: "Watchlist", value: watched ? "✅ Da" : "❌ Nu", inline: true },
          { name: "DLC-uri recente", value: dlc.length ? dlc.join("\n") : unavailable(game.appId ? "Niciun DLC detectat" : "Fara Steam appId"), inline: false }
        ],
        footer: { text: "Sursele sunt izolate: o eroare nu ascunde datele obtinute din celelalte surse." }
      }]
    });
  }

  return { handle };
}

function isGameOverview(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["game"], subcommand: "overview" });
}

function buildGameOverviewHandler(target: GameOverviewDeps) {
  const overview = createGameOverviewHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isGameOverview(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      try {
        return await overview.handle(interaction, games as GameConfig[]);
      } catch (error: unknown) {
        target.logger("ERROR", "GAME_OVERVIEW", "Eroare la /game overview", errorDetail(error));
        const payload = { content: "Eroare: overview-ul jocului nu este disponibil acum.", flags: target.MessageFlags.Ephemeral };
        if ((interaction.deferred || interaction.replied) && interaction.followUp) return interaction.followUp(payload);
        return interaction.reply?.(payload);
      }
    }
  };
  return { overview, ...command };
}

export default { createGameOverviewHandler, buildCommandHandler: buildGameOverviewHandler };

export const GAME_OVERVIEW_HANDLER_KEYS = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "enforceCooldown",
  "executeFetchWithCircuitBreaker",
  "fetchDeals",
  "fetchGameStatusSummary",
  "fetchSteamCurrentPlayers",
  "findGameAndSuggestion",
  "formatPrice",
  "getCurrencyConfig",
  "getDealsCacheData",
  "getGuildSettings",
  "httpReq",
  "logger",
  "safeCheerioLoad",
  "safeDefer",
  "safeEdit",
  "setDealsCache"
] as const;

type GameOverviewKeyCheckDeps = Parameters<typeof buildGameOverviewHandler>[0];
type GameOverviewMissing = MissingDependencyKeys<GameOverviewKeyCheckDeps, (typeof GAME_OVERVIEW_HANDLER_KEYS)[number] & string>;
type GameOverviewExtra = ExtraDependencyKeys<GameOverviewKeyCheckDeps, (typeof GAME_OVERVIEW_HANDLER_KEYS)[number] & string>;
const gameOverviewKeysComplete: ExactDependencyKeys<GameOverviewMissing, GameOverviewExtra> = true;
