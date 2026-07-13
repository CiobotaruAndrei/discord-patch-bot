"use strict";

import type { DealInfo } from "../../types.js";
import {
  DEAL_COLOR,
  WARNING_COLOR,
  numericPrice,
  parseDateMs,
  normalizeText,
  type DiscordEmbed,
  type FormatPrice
} from "./gameInfoEmbedPrimitives.js";

export interface EndingDealsEmbedDeps {
  enrichDealData(deal: DealInfo, currency?: string): Promise<DealInfo>;
  formatPrice: FormatPrice;
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

export function endText(deal: DealInfo): string {
  if (deal.endsAt) {
    const time = parseDateMs(deal.endsAt);
    if (time !== null) return new Date(time).toISOString();
  }
  const text = String(deal.endDateStr || "").trim();
  return text && text.toLowerCase() !== "nespecificat" ? text : "termen necunoscut";
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
