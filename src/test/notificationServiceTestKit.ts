import { createUpdateNotificationService } from "../features/notifications/updateNotificationService";
import { validateUpdateFetchSnapshot as _vUpd, validatePendingDiscountSnapshot as _vDisc } from "../shared/utilities";
import type { GuildDeadLetterRecord } from "../features/notifications/deadLetterRepository";
import { createDiscountNotificationService } from "../features/notifications/discountNotificationService";
import type { GameConfig, DealInfo, ValidatedDealInfo } from "../types";
import { makeNotificationDiscordClient } from "./typedTestBuilders";

export type UpdateDeps = Parameters<typeof createUpdateNotificationService>[0];
export type DiscountDeps = Parameters<typeof createDiscountNotificationService>[0];
export type UpdateService = ReturnType<typeof createUpdateNotificationService>;
export type DiscountService = ReturnType<typeof createDiscountNotificationService>;
export type UpdateGuild = Parameters<UpdateService["processGuildUpdates"]>[1];
export type UpdateResults = Parameters<UpdateService["processGuildUpdates"]>[2];
export type DiscountGuild = Parameters<DiscountService["processGuildDiscounts"]>[1];
export type DiscountDeals = Parameters<DiscountService["processGuildDiscounts"]>[2];
export type SentPayload = { embeds?: unknown; content?: string };
export type SentMeta = { historyEntries?: Array<{ kind: string; gameKey?: string; title?: string; link?: string; itemId?: string }> } | undefined;

import realUtilities from "../shared/utilities";

export const noopDiscordClient = makeNotificationDiscordClient();

export function messageOf(value: unknown): string {
  return value && typeof value === "object" && "message" in value
    ? String((value as { message?: unknown }).message || value)
    : String(value);
}

export function makeUpdateDeps(overrides: Partial<UpdateDeps> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const deadLetterDocs: GuildDeadLetterRecord[] = [];
  const sentPayloads: SentPayload[] = [];
  const claims: Array<{ guildId: string; gameKey: string; updateId: string }> = [];
  const rollbacks: Array<{ guildId: string; gameKey: string; updateId: string }> = [];
  const sentMetas: SentMeta[] = [];
  const channel = {
    id: "channel-1",
    send: async (payload: SentPayload, meta?: SentMeta) => { sentPayloads.push(payload); sentMetas.push(meta); return { id: "msg-1" }; }
  };
  const deps: UpdateDeps = {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updateOneCalls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    GuildDeadLetterModel: {
      insertMany: async (batch: GuildDeadLetterRecord[]) => { for (const doc of batch) deadLetterDocs.push(doc); return batch; },
      find: () => {
        const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
        return chain;
      },
      deleteMany: async () => ({ deletedCount: 0 })
    },
    logger: () => undefined,
    runConcurrent: async <T>(items: T[], _c: number, fn: (item: T) => Promise<unknown>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const it of items) {
        try { await fn(it); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenUpdate: async (gid: string, _cid: string, gkey: string, uid: string) => {
      claims.push({ guildId: gid, gameKey: gkey, updateId: uid });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    rollbackSeenUpdate: async (gid: string, gkey: string, uid: string) => {
      rollbacks.push({ guildId: gid, gameKey: gkey, updateId: uid });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    disableUpdatesForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    seedSeenUpdates: async () => undefined,
    setSeenHashVersion: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: messageOf,
    normalizePendingUpdateArray: (arr: unknown) => Array.isArray(arr) ? arr : [],
    toEntries: (<K, V>(map: Map<K, V> | Record<string, V> | undefined): Array<[K, V]> => map instanceof Map ? Array.from(map.entries()) : (map ? Object.entries(map) as Array<[K, V]> : [])),
    rotateAfter: <T>(keys: T[], lastKey: T | null): T[] => {
      if (!lastKey) return keys;
      const idx = keys.indexOf(lastKey);
      if (idx === -1) return keys;
      return [...keys.slice(idx + 1), ...keys.slice(0, idx + 1)];
    },
    mapToObject: <V>(m: Map<string, V>): Record<string, V> => Object.fromEntries(m.entries()),
    getLatestForAllGames: async (games: GameConfig[]) => games.map(game => ({ game, latest: { id: `u-${game.key}`, title: "", link: "", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: "" }, error: null })),
    validateUpdateFetchSnapshot: _vUpd,
    setUpdatesCache: () => undefined,
    buildUpdateEmbed: (name: string) => ({ title: name }),
    sleepIfPositive: async () => undefined,
    PENDING_UPDATE_MAX_AGE_MS: 86_400_000,
    PENDING_UPDATE_MAX_ATTEMPTS: 5,
    PENDING_UPDATES_PER_GAME_LIMIT: 10,
    MAX_UPDATES_PER_CYCLE: 5,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    ...overrides
  };
  return { deps, updateOneCalls, deadLetterDocs, sentPayloads, sentMetas, claims, rollbacks, channel };
}

export function makeDiscountDeps(overrides: Partial<DiscountDeps> = {}) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const deadLetterDocs: GuildDeadLetterRecord[] = [];
  const sentPayloads: SentPayload[] = [];
  const claims: string[] = [];
  const sentMetas: SentMeta[] = [];
  const channel = {
    id: "channel-d",
    send: async (payload: SentPayload, meta?: SentMeta) => { sentPayloads.push(payload); sentMetas.push(meta); return { id: "msg-1" }; }
  };
  const deps: DiscountDeps = {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updateOneCalls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    GuildDeadLetterModel: {
      insertMany: async (batch: GuildDeadLetterRecord[]) => { for (const doc of batch) deadLetterDocs.push(doc); return batch; },
      find: () => {
        const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
        return chain;
      },
      deleteMany: async () => ({ deletedCount: 0 })
    },
    logger: () => undefined,
    runConcurrent: async <T>(items: T[], _c: number, fn: (item: T) => Promise<unknown>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const it of items) {
        try { await fn(it); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenDiscount: async (_gid: string, _cid: string, hash: string) => {
      claims.push(hash);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    rollbackSeenDiscount: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    loadSeenDiscountHashes: async () => [],
    seedSeenDiscounts: async () => undefined,
    setSeenHashVersion: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    disableDiscountsForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: messageOf,
    normalizePendingDiscountArray: (arr: unknown) => Array.isArray(arr) ? arr : [],
    validatePendingDiscountSnapshot: (snapshot: unknown): snapshot is ValidatedDealInfo => Boolean(snapshot),
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    dealPassesFilters: () => true,
    dealHash: (deal: unknown) => (deal as { id?: string }).id || "h",
    fetchDeals: async () => [{ id: "d1" }],
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    enrichDealData: async (deal: DealInfo) => deal,
    buildDealEmbed: (deal: DealInfo) => ({ deal: deal.id }),
    sleepIfPositive: async () => undefined,
    processGuildPriceAlerts: async () => undefined,
    DEFAULT_CURRENCY: "USD",
    DEALS_HISTORY_LIMIT: 300,
    PENDING_DISCOUNT_MAX_ATTEMPTS: 5,
    PENDING_DISCOUNT_GRACE_CYCLES: 3,
    PENDING_DISCOUNTS_LIMIT: 50,
    MAX_DEALS_PER_CYCLE: 8,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    ...overrides
  };
  return { deps, updateOneCalls, deadLetterDocs, sentPayloads, sentMetas, claims, channel };
}
