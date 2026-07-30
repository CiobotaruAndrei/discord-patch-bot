"use strict";

import type { PriceValue } from "../../types.js";
import type { DealInfo } from "../../sources/sourceTypes.js";

export interface SteamPriceData {
  name?: string;
  is_free?: boolean;
  price_overview?: { initial: number; final: number; discount_percent: number } | null;
}

type FormatPrice = (value: PriceValue, currencyCode?: string | null) => string;

function normalizeTitle(value: string): string {
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

function steamPriceLine(data: SteamPriceData, currency: string, formatPrice: FormatPrice): string {
  if (data.is_free) return "Steam [verde]: GRATUIT";
  const overview = data.price_overview;
  if (!overview) return "Steam [verde]: pret indisponibil";
  const current = overview.final / 100;
  const old = overview.initial / 100;
  const discount = overview.discount_percent;
  if (discount > 0 && old > current) {
    return `Steam [verde]: ${formatPrice(current, currency)} (reducere ${discount}%, pret vechi ${formatPrice(old, currency)})`;
  }
  return `Steam [verde]: ${formatPrice(current, currency)}`;
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value).split(" ").filter(token => token.length >= 2);
}

export function titlesComparable(target: string, title: string): boolean {
  const normalizedTarget = normalizeTitle(target);
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTarget || !normalizedTitle) return false;
  if (normalizedTarget === normalizedTitle) return true;
  const targetTokens = new Set(titleTokens(target));
  const dealTokens = new Set(titleTokens(title));
  if (targetTokens.size === 0 || dealTokens.size === 0) return false;
  let shared = 0;
  for (const token of targetTokens) if (dealTokens.has(token)) shared++;
  const coverage = shared / targetTokens.size;
  const union = targetTokens.size + dealTokens.size - shared;
  const jaccard = union > 0 ? shared / union : 0;
  return coverage === 1 || jaccard >= 0.6;
}

export function findComparableDeals(deals: DealInfo[], query: string, steamName: string, appId: string | number): DealInfo[] {
  const appIdStr = String(appId ?? "").trim();
  const targets = [query, steamName].map(value => String(value || "")).filter(Boolean);
  return deals.filter(deal => {
    const store = normalizeTitle(String(deal.store || ""));
    if (store.includes("steam")) return false;
    if (appIdStr && String(deal.appId ?? "").trim() === appIdStr) return true;
    if (!normalizeTitle(String(deal.title || ""))) return false;
    return targets.some(target => titlesComparable(target, String(deal.title || "")));
  }).slice(0, 5);
}

export function buildPriceCheckEmbed(
  query: string,
  appId: string | number,
  steamData: SteamPriceData,
  externalDeals: DealInfo[],
  currency: string,
  formatPrice: FormatPrice,
  externalError: string | null
): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    {
      name: "Steam",
      value: steamPriceLine(steamData, currency, formatPrice),
      inline: false
    }
  ];
  if (externalDeals.length) {
    for (const deal of externalDeals) {
      const price = numericPrice(deal.salePrice);
      const priceText = price === null ? String(deal.salePrice ?? "pret indisponibil") : formatPrice(price, String(deal.currency || currency));
      const store = String(deal.store || "magazin extern");
      const link = String(deal.link || deal.url || "");
      fields.push({
        name: store,
        value: link ? `${priceText} - ${link}` : priceText,
        inline: false
      });
    }
  } else {
    fields.push({
      name: "Alte surse",
      value: externalError || "Nu am gasit o oferta comparabila in sursele de reduceri active ale botului.",
      inline: false
    });
  }
  return {
    title: `Price check: ${steamData.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: 0x2ecc71,
    description: "Pretul Steam este afisat pe embed-ul verde; celelalte randuri sunt comparatii din sursele externe deja folosite de bot.",
    fields
  };
}
