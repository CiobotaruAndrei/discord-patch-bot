"use strict";

import type { CheerioAPI } from "cheerio";
import type { PriceValue } from "../../types";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis";

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

export function parseDateMs(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
