"use strict";

import type { CheerioAPI } from "cheerio";
import type { DealInfo, GameConfig, GuildSettings, PriceValue, SteamReviewData } from "../../types";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis";
import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail, errorMessage } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type Logger = (level: string, context: string, message: string, meta?: Record<string, string | number | boolean | null>) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, string | number | boolean | null>) => void;
type SteamSearchCandidate = { id?: string | number; name?: string };

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
}

type InteractionReplyPayload = string | {
  content?: string;
  embeds?: DiscordEmbed[];
  flags?: number;
};

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(required?: boolean): string;
    getSubcommandGroup?(required?: boolean): string | null;
    getString(name: string, required?: boolean): string | null;
    getNumber(name: string, required?: boolean): number | null;
    getInteger(name: string, required?: boolean): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: InteractionReplyPayload) => Promise<object | void>;
  followUp?: (payload: InteractionReplyPayload) => Promise<object | void>;
}

interface GameInfoDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, string | number | boolean | null>) => CommandLogEnd;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionReplyPayload): Promise<object | null>;
  searchSteamGameByName(query: string, currency: string): Promise<SteamSearchCandidate[]>;
  chooseBestSteamMatch(items: SteamSearchCandidate[], query: string, options?: { forceGameOnly?: boolean }): SteamSearchCandidate | null;
  fetchSteamPriceDetails(appId: string | number, currency: string): Promise<SteamAppDetailsSummary | null>;
  fetchSteamReviewData(appId: string | number): Promise<SteamReviewData>;
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

type GameInfoContext = GameInfoDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<object | void | null>;
};

const GAME_INFO_COMMANDS = new Set(["best", "ending", "review-trend", "crossplay", "platforms", "co-op", "system", "game-size"]);
const RESULT_LIMIT_DEFAULT = 5;
const RESULT_LIMIT_MAX = 10;
const INFO_COLOR = 0x3498db;
const DEAL_COLOR = 0x2ecc71;
const WARNING_COLOR = 0xf1c40f;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numericPrice(value: PriceValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampResultLimit(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return RESULT_LIMIT_DEFAULT;
  return Math.max(1, Math.min(RESULT_LIMIT_MAX, Math.round(value)));
}

function dealDiscount(deal: DealInfo): number {
  const direct = typeof deal.discountPercent === "number" ? deal.discountPercent : Number(deal.savings);
  if (Number.isFinite(direct) && direct > 0) return Math.max(0, Math.min(100, Math.round(direct)));
  const normal = numericPrice(deal.normalPrice);
  const sale = numericPrice(deal.salePrice);
  if (normal !== null && sale !== null && normal > sale) return Math.round(((normal - sale) / normal) * 100);
  return 0;
}

function dealScore(deal: DealInfo, budget: number): number {
  const price = numericPrice(deal.salePrice) ?? budget;
  const discount = dealDiscount(deal);
  const quality = typeof deal.qualityScore === "number" && Number.isFinite(deal.qualityScore) ? deal.qualityScore : 50;
  const reviews = typeof deal.totalReviews === "number" && Number.isFinite(deal.totalReviews) ? Math.min(25, Math.floor(deal.totalReviews / 1000)) : 0;
  const budgetFit = budget > 0 ? Math.max(0, Math.min(25, ((budget - price) / budget) * 25)) : 0;
  return discount * 1.5 + quality * 0.4 + reviews + budgetFit;
}

function formatDealLine(deal: DealInfo, currency: string, formatPrice: GameInfoDeps["formatPrice"]): string {
  const price = numericPrice(deal.salePrice);
  const priceText = price === null ? String(deal.salePrice ?? "pret indisponibil") : formatPrice(price, String(deal.currency || currency));
  const discount = dealDiscount(deal);
  const store = String(deal.store || "magazin necunoscut");
  const link = String(deal.link || deal.url || "");
  const title = String(deal.title || "Oferta fara titlu");
  const discountText = discount > 0 ? `, reducere ${discount}%` : "";
  return link ? `[${title}](${link}) - ${priceText}${discountText} (${store})` : `${title} - ${priceText}${discountText} (${store})`;
}

function parseDateMs(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function endText(deal: DealInfo): string {
  if (deal.endsAt) {
    const time = parseDateMs(deal.endsAt);
    if (time !== null) return new Date(time).toISOString();
  }
  const text = String(deal.endDateStr || "").trim();
  return text && text.toLowerCase() !== "nespecificat" ? text : "termen necunoscut";
}

function htmlToText(value: string | null | undefined, load: GameInfoDeps["safeCheerioLoad"]): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const page = load(raw);
  return page.text().replace(/\s+/g, " ").trim();
}

function hasRequirementSections(value: SteamAppDetailsSummary["pc_requirements"]): value is { minimum?: string; recommended?: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirementValue(details: SteamAppDetailsSummary, key: "minimum" | "recommended", load: GameInfoDeps["safeCheerioLoad"]): string {
  const req = details.pc_requirements;
  if (!req) return "";
  if (typeof req === "string") return key === "minimum" ? htmlToText(req, load) : "";
  if (!hasRequirementSections(req)) return "";
  const section = key === "minimum" ? req.minimum : req.recommended;
  return htmlToText(section, load);
}

function extractInstallSize(details: SteamAppDetailsSummary, load: GameInfoDeps["safeCheerioLoad"]): string | null {
  const text = [requirementValue(details, "minimum", load), requirementValue(details, "recommended", load)].join(" ");
  const match = /(?:Storage|Hard Drive):\s*([^.;]+?(?:GB|MB)[^.;]*)/i.exec(text);
  return match ? match[1].trim() : null;
}

function categoryDescriptions(details: SteamAppDetailsSummary): string[] {
  return (details.categories || [])
    .map(category => String(category.description || "").trim())
    .filter(Boolean);
}

function hasCategory(details: SteamAppDetailsSummary, needle: string): boolean {
  const normalizedNeedle = normalizeText(needle);
  return categoryDescriptions(details).some(category => normalizeText(category).includes(normalizedNeedle));
}

function platformList(details: SteamAppDetailsSummary): string[] {
  const platforms = details.platforms || {};
  const result: string[] = [];
  if (platforms.windows) result.push("Windows");
  if (platforms.mac) result.push("macOS");
  if (platforms.linux) result.push("Linux");
  return result;
}

function buildBestDealsEmbed(deals: DealInfo[], budget: number, currency: string, limit: number, formatPrice: GameInfoDeps["formatPrice"]): DiscordEmbed {
  const filtered = deals
    .filter(deal => {
      const price = numericPrice(deal.salePrice);
      return price !== null && price <= budget;
    })
    .sort((left, right) => dealScore(right, budget) - dealScore(left, budget))
    .slice(0, limit);
  if (!filtered.length) {
    return {
      title: `Best deals under ${formatPrice(budget, currency)}`,
      color: WARNING_COLOR,
      description: "Nu am gasit reduceri sub bugetul cerut in sursele active."
    };
  }
  return {
    title: `Best deals under ${formatPrice(budget, currency)}`,
    color: DEAL_COLOR,
    description: "Cautarea foloseste toate sursele de reduceri active, nu doar watchlist-ul serverului.",
    fields: filtered.map((deal, index) => ({
      name: `${index + 1}. ${String(deal.title || "Oferta fara titlu").slice(0, 80)}`,
      value: formatDealLine(deal, currency, formatPrice),
      inline: false
    }))
  };
}

async function buildEndingDealsEmbed(deps: GameInfoDeps, deals: DealInfo[], currency: string, limit: number): Promise<DiscordEmbed> {
  const enriched = await Promise.all(deals.slice(0, 30).map(deal => deps.enrichDealData(deal, currency).catch(() => deal)));
  const ending = enriched
    .map(deal => ({ deal, endMs: parseDateMs(deal.endsAt), text: endText(deal) }))
    .filter(item => item.endMs !== null || item.text !== "termen necunoscut")
    .sort((left, right) => (left.endMs ?? Number.MAX_SAFE_INTEGER) - (right.endMs ?? Number.MAX_SAFE_INTEGER))
    .slice(0, limit);
  if (!ending.length) {
    return {
      title: "Ending deals",
      color: WARNING_COLOR,
      description: "Nu am gasit oferte cu termen de expirare clar in sursele active."
    };
  }
  return {
    title: "Ending deals",
    color: DEAL_COLOR,
    description: "Oferte sortate dupa termenul de expirare detectat din sursele de reduceri.",
    fields: ending.map((item, index) => ({
      name: `${index + 1}. ${String(item.deal.title || "Oferta fara titlu").slice(0, 80)}`,
      value: `${formatDealLine(item.deal, currency, deps.formatPrice)}\nExpira: ${item.text}`,
      inline: false
    }))
  };
}

function buildReviewTrendEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, review: SteamReviewData): DiscordEmbed {
  if (!review.success) {
    return {
      title: `Review trend: ${details.name || query}`,
      url: `https://store.steampowered.com/app/${appId}`,
      color: WARNING_COLOR,
      description: "Steam nu a returnat suficiente date de review pentru acest joc."
    };
  }
  const quality = review.qualityPercent;
  const label = quality >= 85 ? "foarte pozitiv" : quality >= 70 ? "pozitiv" : quality >= 50 ? "mixt" : "negativ";
  const trend = quality >= 70 ? "stabil pozitiv in snapshot-ul Steam curent" : quality >= 50 ? "zona mixta, merita verificat manual" : "semnal negativ puternic in snapshot-ul Steam curent";
  return {
    title: `Review trend: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Rezumat", value: `${quality}% pozitiv din ${review.totalReviews} review-uri`, inline: false },
      { name: "Interpretare", value: `${label}; ${trend}.`, inline: false },
      { name: "Nota", value: "Botul foloseste datele Steam curente. Trend istoric real cere stocare pe timp si va trebui adaugat separat.", inline: false }
    ]
  };
}

function buildCrossplayEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary): DiscordEmbed {
  const crossplay = hasCategory(details, "Cross-Platform Multiplayer");
  const steamCloud = hasCategory(details, "Steam Cloud");
  return {
    title: `Crossplay: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Crossplay", value: crossplay ? "Detectat pe Steam ca Cross-Platform Multiplayer." : "Nedetectat in metadatele Steam curente.", inline: false },
      { name: "Cross-save/progression", value: steamCloud ? "Steam Cloud este detectat, dar asta nu confirma automat cross-save intre magazine/platforme externe." : "Nedetectat in metadatele Steam curente.", inline: false }
    ]
  };
}

function buildPlatformsEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, externalStores: string[]): DiscordEmbed {
  const platforms = platformList(details);
  const stores = ["Steam", ...externalStores].filter((store, index, list) => list.indexOf(store) === index);
  return {
    title: `Platforms: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Platforme Steam", value: platforms.length ? platforms.join(", ") : "Nedetectat in metadatele Steam curente.", inline: false },
      { name: "Magazine detectate in sursele de reduceri", value: stores.join(", "), inline: false }
    ]
  };
}

function buildCoopEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary): DiscordEmbed {
  const modes = [
    hasCategory(details, "Single-player") ? "Single-player" : "",
    hasCategory(details, "Online Co-op") ? "Online co-op" : "",
    hasCategory(details, "Shared/Split Screen Co-op") ? "Local/split-screen co-op" : "",
    hasCategory(details, "PvP") ? "PvP" : "",
    hasCategory(details, "MMO") ? "MMO" : ""
  ].filter(Boolean);
  return {
    title: `Co-op: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    description: modes.length ? modes.join(", ") : "Steam nu listeaza modurile de joc in sursa curenta."
  };
}

function buildSystemRequirementsEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: GameInfoDeps["safeCheerioLoad"]): DiscordEmbed {
  const minimum = requirementValue(details, "minimum", load);
  const recommended = requirementValue(details, "recommended", load);
  return {
    title: `System requirements: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Minim", value: minimum.slice(0, 1000) || "Nedisponibil in metadatele Steam curente.", inline: false },
      { name: "Recomandat", value: recommended.slice(0, 1000) || "Nedisponibil in metadatele Steam curente.", inline: false }
    ]
  };
}

function buildGameSizeEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: GameInfoDeps["safeCheerioLoad"]): DiscordEmbed {
  const size = extractInstallSize(details, load);
  return {
    title: `Game size: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    description: size ? `Dimensiune instalare detectata: **${size}**.` : "Steam nu expune o dimensiune clara in cerintele de sistem curente."
  };
}

function findExternalStores(deals: DealInfo[], query: string, steamName: string, appId: string | number): string[] {
  const appIdStr = String(appId);
  const queryNorm = normalizeText(query);
  const steamNorm = normalizeText(steamName);
  const stores: string[] = [];
  for (const deal of deals) {
    const store = String(deal.store || "").trim();
    if (!store || normalizeText(store).includes("steam")) continue;
    const title = normalizeText(String(deal.title || ""));
    const sameApp = String(deal.appId || deal.steamAppID || "") === appIdStr;
    const sameTitle = title && (title === queryNorm || title === steamNorm || title.includes(steamNorm) || steamNorm.includes(title));
    if ((sameApp || sameTitle) && !stores.includes(store)) stores.push(store);
  }
  return stores.slice(0, 6);
}

function createGameInfoInteractionHandler(deps: GameInfoDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit, searchSteamGameByName,
    chooseBestSteamMatch, fetchSteamPriceDetails, fetchSteamReviewData, getDealsCacheData,
    setDealsCache, fetchDeals, getGuildSettings, DEFAULT_CURRENCY
  } = deps;

  async function resolveCurrency(interaction: DiscordInteraction): Promise<string> {
    const explicit = interaction.options.getString("currency", false);
    if (explicit) return explicit;
    const guild = interaction.guild?.id ? await getGuildSettings(interaction.guild.id) : null;
    return String(guild?.currency || DEFAULT_CURRENCY);
  }

  async function loadDeals(currency: string): Promise<DealInfo[]> {
    const cached = getDealsCacheData(currency);
    if (cached) return cached;
    const deals = await fetchDeals({ currency });
    setDealsCache(currency, deals);
    return deals;
  }

  async function resolveSteam(query: string, currency: string): Promise<{ appId: string | number; details: SteamAppDetailsSummary } | null> {
    const items = await searchSteamGameByName(query, currency);
    const best = chooseBestSteamMatch(items, query, { forceGameOnly: true });
    if (!best?.id) return null;
    const details = await fetchSteamPriceDetails(best.id, currency);
    return details ? { appId: best.id, details } : null;
  }

  async function handleDealsCommand(interaction: DiscordInteraction): Promise<object | void | null> {
    const command = interaction.commandName || "";
    const currency = await resolveCurrency(interaction);
    const limit = clampResultLimit(interaction.options.getInteger("numar", false));
    const deals = await loadDeals(currency);
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
    const resolved = await resolveSteam(query, currency);
    if (!resolved) return safeEdit(interaction, `Eroare: nu am gasit jocul \`${query}\` pe Steam.`);
    const { appId, details } = resolved;
    if (interaction.commandName === "review-trend") {
      const review = await fetchSteamReviewData(appId);
      return safeEdit(interaction, { embeds: [buildReviewTrendEmbed(query, appId, details, review)] });
    }
    if (interaction.commandName === "crossplay") return safeEdit(interaction, { embeds: [buildCrossplayEmbed(query, appId, details)] });
    if (interaction.commandName === "co-op") return safeEdit(interaction, { embeds: [buildCoopEmbed(query, appId, details)] });
    if (interaction.commandName === "system") return safeEdit(interaction, { embeds: [buildSystemRequirementsEmbed(query, appId, details, deps.safeCheerioLoad)] });
    if (interaction.commandName === "game-size") return safeEdit(interaction, { embeds: [buildGameSizeEmbed(query, appId, details, deps.safeCheerioLoad)] });
    const deals = await loadDeals(currency).catch(() => []);
    return safeEdit(interaction, { embeds: [buildPlatformsEmbed(query, appId, details, findExternalStores(deals, query, details.name || query, appId))] });
  }

  async function handleGameInfo(interaction: DiscordInteraction): Promise<object | void | null> {
    const command = interaction.commandName || "";
    if (!(await enforceCooldown(interaction, command))) return undefined;
    const endLog = startCommandLog(interaction, command);
    await safeDefer(interaction);
    try {
      const result = command === "best" || command === "ending"
        ? await handleDealsCommand(interaction)
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
  return typeof commandName === "string"
    && GAME_INFO_COMMANDS.has(commandName)
    && typeof isChatInputCommand === "function"
    && isChatInputCommand.call(interaction) === true
    && Boolean(guild);
}

function buildGameInfoCommandHandler(target: GameInfoContext) {
  const handlers = createGameInfoInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: isGameInfoCommand,
    handle: async (interaction) => {
      try {
        return await handlers.handleGameInfo(interaction);
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

function installGameInfoInteractionHandler(target: GameInfoContext): void {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildGameInfoCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}

export = Object.assign(installGameInfoInteractionHandler, {
  createGameInfoInteractionHandler,
  buildBestDealsEmbed,
  buildEndingDealsEmbed,
  buildReviewTrendEmbed,
  buildCrossplayEmbed,
  buildPlatformsEmbed,
  buildCoopEmbed,
  buildSystemRequirementsEmbed,
  buildGameSizeEmbed,
  extractInstallSize,
  buildCommandHandler: buildGameInfoCommandHandler
});
