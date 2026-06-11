"use strict";

import { createUpdateNotificationService } from "../features/notifications/updateNotificationService";
import { createDiscountNotificationService } from "../features/notifications/discountNotificationService";

type UpdateDeps = Parameters<typeof createUpdateNotificationService>[0];
type DiscountDeps = Parameters<typeof createDiscountNotificationService>[0];

interface Counters {
  discordSends: number;
  mongoWrites: number;
  fetches: number;
}

export interface FlowMetrics {
  durationMs: number;
  discordSends: number;
  mongoWrites: number;
  fetches: number;
}

export interface BenchmarkRow {
  guilds: number;
  updates: FlowMetrics;
  discounts: FlowMetrics;
}

export interface BenchmarkOptions {
  gamesPerCycle?: number;
}

async function runConcurrent<T>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<unknown>): Promise<{ processed: number; errors: Array<{ error: unknown }> }> {
  let cursor = 0;
  let processed = 0;
  const errors: Array<{ error: unknown }> = [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        await fn(items[idx], idx);
        processed++;
      } catch (error) {
        errors.push({ error });
      }
    }
  });
  await Promise.all(workers);
  return { processed, errors };
}

function entriesFrom(value: unknown): Array<[string, unknown]> {
  if (value instanceof Map) return Array.from(value.entries()).map(([key, val]) => [String(key), val]);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return [];
}

function makeUpdateDeps(counters: Counters): UpdateDeps {
  const channel = { id: "chan", send: async () => { counters.discordSends++; return { id: "m" }; } };
  return {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async () => { counters.mongoWrites++; return { matchedCount: 1, modifiedCount: 1 }; }
    },
    logger: () => undefined,
    runConcurrent,
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenUpdate: async () => { counters.mongoWrites++; return { matchedCount: 1, modifiedCount: 1 }; },
    rollbackSeenUpdate: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    disableUpdatesForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: (err: unknown) => String(err),
    normalizePendingUpdateArray: (arr: unknown) => Array.isArray(arr) ? arr : [],
    toEntries: entriesFrom,
    rotateAfter: (keys: string[], lastKey: string | null) => {
      if (!lastKey) return keys;
      const idx = keys.indexOf(lastKey);
      if (idx === -1) return keys;
      return [...keys.slice(idx + 1), ...keys.slice(0, idx + 1)];
    },
    mapToObject: (m: Map<string, unknown>) => Object.fromEntries(m.entries()),
    getLatestForAllGames: async (games: Array<{ key: string; name?: string }>) => {
      counters.fetches += games.length;
      return games.map(game => ({ game, latest: { id: `u-${game.key}`, title: "patch" } }));
    },
    setUpdatesCache: () => undefined,
    buildUpdateEmbed: () => ({}),
    sleepIfPositive: async () => undefined,
    PENDING_UPDATE_MAX_AGE_MS: 86_400_000,
    PENDING_UPDATE_MAX_ATTEMPTS: 5,
    PENDING_UPDATES_PER_GAME_LIMIT: 10,
    MAX_UPDATES_PER_CYCLE: 5,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 3
  } as unknown as UpdateDeps;
}

function makeDiscountDeps(counters: Counters): DiscountDeps {
  const channel = { id: "chan", send: async () => { counters.discordSends++; return { id: "m" }; } };
  return {
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async () => { counters.mongoWrites++; return { matchedCount: 1, modifiedCount: 1 }; }
    },
    logger: () => undefined,
    runConcurrent,
    resolveOutboundChannel: async () => ({ channel, abort: false }),
    claimSeenDiscount: async () => { counters.mongoWrites++; return { matchedCount: 1, modifiedCount: 1 }; },
    rollbackSeenDiscount: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    loadSeenDiscountHashes: async () => [],
    disableDiscountsForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    isPermanentDiscordError: () => false,
    transientErrorMessage: (err: unknown) => String(err),
    normalizePendingDiscountArray: (arr: unknown) => Array.isArray(arr) ? arr : [],
    validatePendingDiscountSnapshot: () => true,
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD").toUpperCase(),
    dealPassesFilters: () => true,
    dealHash: (deal: { id?: string }) => String(deal.id || "h"),
    fetchDeals: async () => { counters.fetches++; return Array.from({ length: 8 }, (_, i) => ({ id: `d${i}` })); },
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    enrichDealData: async (deal: unknown) => deal,
    buildDealEmbed: () => ({}),
    sleepIfPositive: async () => undefined,
    DEFAULT_CURRENCY: "USD",
    DEALS_HISTORY_LIMIT: 300,
    PENDING_DISCOUNT_MAX_ATTEMPTS: 10,
    PENDING_DISCOUNT_GRACE_CYCLES: 3,
    PENDING_DISCOUNTS_LIMIT: 200,
    MAX_DEALS_PER_CYCLE: 8,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 3
  } as unknown as DiscountDeps;
}

function makeUpdateGuilds(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `g${i}`, subscribed: true, notificationChannelId: `chan-${i}`, seenHashVersionUpdates: 2,
    seen: {}, pendingUpdates: {}, enabledGames: []
  }));
}

function makeDiscountGuilds(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `g${i}`, discountsSubscribed: true, discountChannelId: `chan-${i}`, seenHashVersionDiscounts: 2,
    seenDiscounts: [], pendingDiscounts: [], currency: "USD"
  }));
}

async function measureFlow(run: () => Promise<void>, counters: Counters): Promise<FlowMetrics> {
  counters.discordSends = 0;
  counters.mongoWrites = 0;
  counters.fetches = 0;
  const start = Date.now();
  await run();
  return {
    durationMs: Date.now() - start,
    discordSends: counters.discordSends,
    mongoWrites: counters.mongoWrites,
    fetches: counters.fetches
  };
}

export async function runNotificationBenchmark(
  guildCounts: number[],
  options: BenchmarkOptions = {}
): Promise<BenchmarkRow[]> {
  const gamesPerCycle = options.gamesPerCycle ?? 8;
  const games = Array.from({ length: gamesPerCycle }, (_, i) => ({ key: `game${i}`, name: `Game ${i}` }));
  const rows: BenchmarkRow[] = [];

  for (const guilds of guildCounts) {
    const updateCounters: Counters = { discordSends: 0, mongoWrites: 0, fetches: 0 };
    const updateGuilds = makeUpdateGuilds(guilds);
    const updateDeps = makeUpdateDeps(updateCounters);
    (updateDeps as unknown as { GuildModel: { find: () => { lean: () => Promise<unknown[]> } } }).GuildModel.find =
      () => ({ lean: async () => updateGuilds });
    const updateService = createUpdateNotificationService(updateDeps);
    const updates = await measureFlow(() => updateService.checkForUpdates({}, games), updateCounters);

    const discountCounters: Counters = { discordSends: 0, mongoWrites: 0, fetches: 0 };
    const discountGuilds = makeDiscountGuilds(guilds);
    const discountDeps = makeDiscountDeps(discountCounters);
    (discountDeps as unknown as { GuildModel: { find: () => { lean: () => Promise<unknown[]> } } }).GuildModel.find =
      () => ({ lean: async () => discountGuilds });
    const discountService = createDiscountNotificationService(discountDeps);
    const discounts = await measureFlow(() => discountService.checkForDiscounts({}), discountCounters);

    rows.push({ guilds, updates, discounts });
  }
  return rows;
}

function formatTable(rows: BenchmarkRow[]): string {
  const header = "guilds | flow      | durationMs | discordSends | mongoWrites | fetches";
  const lines = [header, "-".repeat(header.length)];
  for (const row of rows) {
    lines.push(`${String(row.guilds).padStart(6)} | updates   | ${String(row.updates.durationMs).padStart(10)} | ${String(row.updates.discordSends).padStart(12)} | ${String(row.updates.mongoWrites).padStart(11)} | ${String(row.updates.fetches).padStart(7)}`);
    lines.push(`${String(row.guilds).padStart(6)} | discounts | ${String(row.discounts.durationMs).padStart(10)} | ${String(row.discounts.discordSends).padStart(12)} | ${String(row.discounts.mongoWrites).padStart(11)} | ${String(row.discounts.fetches).padStart(7)}`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  const counts = (process.env.BENCHMARK_GUILDS || "100,500,1000")
    .split(",").map(value => parseInt(value.trim(), 10)).filter(value => Number.isFinite(value) && value > 0);
  runNotificationBenchmark(counts).then(rows => {
    console.log(formatTable(rows));
  }).catch((err: unknown) => {
    console.error("benchmark failed", err);
    process.exitCode = 1;
  });
}
