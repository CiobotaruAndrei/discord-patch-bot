import type { DealInfo, GuildSettings, PendingDiscount, PendingUpdate } from "../../types";
import { dealPassesFilters as nativeDealPassesFilters } from "../../native/fuzzy";

export type EntrySource = Map<string, unknown> | Record<string, unknown> | { toObject(): Record<string, unknown> } | null | undefined;

export function dealPassesFilters(deal: DealInfo, guild: GuildSettings | null | undefined): boolean {
  return nativeDealPassesFilters(deal, guild);
}

function coerceValidDate(raw: unknown): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (raw === null || raw === undefined || raw === "") return new Date();
  const parsed = new Date(raw as string | number);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function normalizePendingUpdateArray(arr: unknown): PendingUpdate[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    const candidate = item as Record<string, unknown> | null;
    if (!candidate || typeof candidate !== "object" || !candidate.id) return null;
    return {
      id: String(candidate.id),
      title: String(candidate.title || ""),
      link: String(candidate.link || ""),
      excerpt: String(candidate.excerpt || ""),
      thumbnail: candidate.thumbnail || null,
      image: candidate.image || null,
      timestamp: candidate.timestamp || "",
      createdAt: coerceValidDate(candidate.createdAt),
      attempts: typeof candidate.attempts === "number" ? candidate.attempts : 0
    } as PendingUpdate;
  }).filter((item): item is PendingUpdate => Boolean(item));
}

export function normalizePendingDiscountArray(arr: unknown): PendingDiscount[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    const candidate = item as Record<string, unknown> | null;
    if (!candidate || typeof candidate !== "object" || !candidate.hash) return null;
    return {
      hash: String(candidate.hash),
      snapshot: (candidate.snapshot || null) as PendingDiscount["snapshot"],
      lastSeenAt: coerceValidDate(candidate.lastSeenAt),
      attempts: typeof candidate.attempts === "number" ? candidate.attempts : 0
    } as PendingDiscount;
  }).filter((item): item is PendingDiscount => Boolean(item));
}

export function toEntries(value: EntrySource): Array<[string, unknown]> {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.entries());
  if (typeof (value as { toObject?: unknown }).toObject === "function") {
    return Object.entries((value as { toObject(): Record<string, unknown> }).toObject());
  }
  return Object.entries(value);
}

export function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(Array.from(map.entries()));
}

export function getSeenSet(guild: Pick<GuildSettings, "seen">, gameKey: string): Set<string> {
  const seenEntries = toEntries(guild.seen as EntrySource);
  const found = seenEntries.find(([key]) => key === gameKey);
  return new Set(Array.isArray(found?.[1]) ? found[1].map(String) : []);
}

export function rotateAfter<T>(keys: T[], lastKey: T | null | undefined): T[] {
  if (!lastKey || !keys.includes(lastKey)) return keys;
  const index = keys.indexOf(lastKey);
  return keys.slice(index + 1).concat(keys.slice(0, index + 1));
}
