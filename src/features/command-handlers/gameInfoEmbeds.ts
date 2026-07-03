"use strict";

import type { CheerioAPI } from "cheerio";
import type { DealInfo, GameConfig, PriceValue, SteamReviewData } from "../../types";
import type { SteamAppDetailsSummary, SteamCurrentPlayersSummary } from "../../sources/sourceApis";

export type SafeCheerioLoad = (html: string) => CheerioAPI;
export type FormatPrice = (value: PriceValue, currencyCode?: string | null) => string;

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
}

export interface EndingDealsEmbedDeps {
  enrichDealData(deal: DealInfo, currency?: string): Promise<DealInfo>;
  formatPrice: FormatPrice;
}

export const RESULT_LIMIT_DEFAULT = 5;
export const RESULT_LIMIT_MAX = 10;
export const INFO_COLOR = 0x3498db;
export const DEAL_COLOR = 0x2ecc71;
export const WARNING_COLOR = 0xf1c40f;

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function numericPrice(value: PriceValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function clampResultLimit(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return RESULT_LIMIT_DEFAULT;
  return Math.max(1, Math.min(RESULT_LIMIT_MAX, Math.round(value)));
}

export function dealDiscount(deal: DealInfo): number {
  const direct = typeof deal.discountPercent === "number" ? deal.discountPercent : Number(deal.savings);
  if (Number.isFinite(direct) && direct > 0) return Math.max(0, Math.min(100, Math.round(direct)));
  const normal = numericPrice(deal.normalPrice);
  const sale = numericPrice(deal.salePrice);
  if (normal !== null && sale !== null && normal > sale) return Math.round(((normal - sale) / normal) * 100);
  return 0;
}

export function dealScore(deal: DealInfo, budget: number): number {
  const price = numericPrice(deal.salePrice) ?? budget;
  const discount = dealDiscount(deal);
  const quality = typeof deal.qualityScore === "number" && Number.isFinite(deal.qualityScore) ? deal.qualityScore : 50;
  const reviews = typeof deal.totalReviews === "number" && Number.isFinite(deal.totalReviews) ? Math.min(25, Math.floor(deal.totalReviews / 1000)) : 0;
  const budgetFit = budget > 0 ? Math.max(0, Math.min(25, ((budget - price) / budget) * 25)) : 0;
  return discount * 1.5 + quality * 0.4 + reviews + budgetFit;
}

export function formatDealLine(deal: DealInfo, currency: string, formatPrice: FormatPrice): string {
  const price = numericPrice(deal.salePrice);
  const priceText = price === null ? String(deal.salePrice ?? "pret indisponibil") : formatPrice(price, String(deal.currency || currency));
  const discount = dealDiscount(deal);
  const store = String(deal.store || "magazin necunoscut");
  const link = String(deal.link || deal.url || "");
  const title = String(deal.title || "Oferta fara titlu");
  const discountText = discount > 0 ? `, reducere ${discount}%` : "";
  return link ? `[${title}](${link}) - ${priceText}${discountText} (${store})` : `${title} - ${priceText}${discountText} (${store})`;
}

export function parseDateMs(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function endText(deal: DealInfo): string {
  if (deal.endsAt) {
    const time = parseDateMs(deal.endsAt);
    if (time !== null) return new Date(time).toISOString();
  }
  const text = String(deal.endDateStr || "").trim();
  return text && text.toLowerCase() !== "nespecificat" ? text : "termen necunoscut";
}

export function htmlToText(value: string | null | undefined, load: SafeCheerioLoad): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const page = load(raw);
  return page.text().replace(/\s+/g, " ").trim();
}

function hasRequirementSections(value: SteamAppDetailsSummary["pc_requirements"]): value is { minimum?: string; recommended?: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requirementValue(details: SteamAppDetailsSummary, key: "minimum" | "recommended", load: SafeCheerioLoad): string {
  const req = details.pc_requirements;
  if (!req) return "";
  if (typeof req === "string") return key === "minimum" ? htmlToText(req, load) : "";
  if (!hasRequirementSections(req)) return "";
  const section = key === "minimum" ? req.minimum : req.recommended;
  return htmlToText(section, load);
}

export function extractInstallSize(details: SteamAppDetailsSummary, load: SafeCheerioLoad): string | null {
  const text = [requirementValue(details, "minimum", load), requirementValue(details, "recommended", load)].join(" ");
  const match = /(?:Storage|Hard Drive):\s*([^.;]+?(?:GB|MB)[^.;]*)/i.exec(text);
  return match ? match[1].trim() : null;
}

function categoryDescriptions(details: SteamAppDetailsSummary): string[] {
  return (details.categories || [])
    .map(category => String(category.description || "").trim())
    .filter(Boolean);
}

export function hasCategory(details: SteamAppDetailsSummary, needle: string): boolean {
  const normalizedNeedle = normalizeText(needle);
  return categoryDescriptions(details).some(category => normalizeText(category).includes(normalizedNeedle));
}

export function platformList(details: SteamAppDetailsSummary): string[] {
  const platforms = details.platforms || {};
  const result: string[] = [];
  if (platforms.windows) result.push("Windows");
  if (platforms.mac) result.push("macOS");
  if (platforms.linux) result.push("Linux");
  return result;
}

export function buildBestDealsEmbed(deals: DealInfo[], budget: number, currency: string, limit: number, formatPrice: FormatPrice): DiscordEmbed {
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

export async function buildEndingDealsEmbed(deps: EndingDealsEmbedDeps, deals: DealInfo[], currency: string, limit: number): Promise<DiscordEmbed> {
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

export function buildReviewTrendEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, review: SteamReviewData): DiscordEmbed {
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

export function buildCrossplayEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary): DiscordEmbed {
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

export function buildPlatformsEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, externalStores: string[]): DiscordEmbed {
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

export function buildCoopEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary): DiscordEmbed {
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

export function buildSystemRequirementsEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: SafeCheerioLoad): DiscordEmbed {
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

export function buildGameSizeEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: SafeCheerioLoad): DiscordEmbed {
  const size = extractInstallSize(details, load);
  return {
    title: `Game size: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    description: size ? `Dimensiune instalare detectata: **${size}**.` : "Steam nu expune o dimensiune clara in cerintele de sistem curente."
  };
}

export function formatPlayerCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

export function buildPlayerCountEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, players: SteamCurrentPlayersSummary): DiscordEmbed {
  return {
    title: `Player count: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: players.success ? INFO_COLOR : WARNING_COLOR,
    description: players.success
      ? `Jucatori activi pe Steam acum: **${formatPlayerCount(players.playerCount)}**.`
      : "Steam nu a returnat un numar valid de jucatori activi pentru acest joc."
  };
}

export function buildTopActiveGamesEmbed(items: Array<{ game: GameConfig; players: SteamCurrentPlayersSummary }>, limit = RESULT_LIMIT_DEFAULT, notChecked = 0): DiscordEmbed {
  const successful = items
    .filter(item => item.players.success)
    .sort((left, right) => right.players.playerCount - left.players.playerCount)
    .slice(0, limit);
  const missing = items.length - items.filter(item => item.players.success).length;
  if (!successful.length) {
    return {
      title: "Top active games",
      color: WARNING_COLOR,
      description: "Steam nu a returnat date valide de player count pentru jocurile verificate."
    };
  }
  const base = "Top calculat din toate jocurile cunoscute de bot care au Steam appId.";
  const missingNote = missing > 0 ? ` ${missing} joc(uri) nu au putut fi verificate pe Steam acum si au fost omise.` : "";
  const subsetNote = notChecked > 0 ? ` Topul e calculat din primele ${items.length} jocuri verificate; alte ${notChecked} nu au fost verificate in acest raspuns.` : "";
  return {
    title: "Top active games",
    color: INFO_COLOR,
    description: `${base}${missingNote}${subsetNote}`,
    fields: successful.map((item, index) => ({
      name: `${index + 1}. ${item.game.name}`,
      value: `${formatPlayerCount(item.players.playerCount)} jucatori activi pe Steam`,
      inline: false
    }))
  };
}

export function findExternalStores(deals: DealInfo[], query: string, steamName: string, appId: string | number): string[] {
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

export function selectTopActiveGames(games: GameConfig[]): GameConfig[] {
  return games.filter(game => Boolean(game.appId));
}
