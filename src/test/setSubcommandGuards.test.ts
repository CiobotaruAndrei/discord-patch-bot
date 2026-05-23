import test from "node:test";
import assert from "node:assert/strict";

// legacyInteractionRouter.ts is CommonJS-style `module.exports = (ctx) => {...}`.
const attachInteractions = require("../features/command-router/legacyInteractionRouter") as (ctx: Record<string, any>) => void;

function makeCtx(replies: unknown[], mongoCalls: unknown[][]) {
  return {
    // Discord helpers (only the ones touched by the /set branches we exercise).
    EmbedBuilder: class {},
    ActionRowBuilder: class {},
    ButtonBuilder: class {},
    ButtonStyle: {},
    ComponentType: {},
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    COLORS: {},
    truncate: (s: string) => s,
    DEFAULT_CURRENCY: "USD",
    formatPrice: (v: unknown) => String(v),
    COLLECTOR_TIMEOUT_MS: 60_000,
    MAX_FUZZY_SEARCH_INPUT: 100,
    httpReq: async () => ({ data: {} }),
    // Mongo + cache state.
    GuildModel: {
      updateOne: async (...args: unknown[]) => {
        mongoCalls.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findById: () => ({ lean: async () => null })
    },
    invalidateGuildCache: () => undefined,
    getGuildSettings: async () => null,
    // UI helpers that the router calls.
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    formatUserError: (_err: unknown, fallback: string) => fallback,
    findGameAndSuggestion: () => ({ game: null, suggestion: null }),
    buildUpdateEmbed: () => ({}),
    buildDealEmbed: () => ({}),
    buildSteamPriceEmbed: () => ({}),
    handlePagination: async () => undefined,
    dealPassesFilters: () => true,
    canSendEmbeds: () => true,
    missingChannelPermsMessage: () => "missing perms",
    makeActivationId: () => "id",
    smoothTime: () => 0,
    fetchGameStatus: async () => ({}),
    // Cache layer
    cache: { single: new Map(), dlc: new Map() },
    cacheGetLRU: () => null,
    cacheSetLRU: () => undefined,
    getUpdatesCacheData: () => null,
    setUpdatesCache: () => undefined,
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    // Other deps the IIFE destructures.
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" }),
    executeFetchWithCircuitBreaker: async () => ({ game: {}, latest: null, error: null }),
    getLatestForAllGames: async () => [],
    fetchDeals: async () => [],
    enrichDealData: async (d: unknown) => d,
    dealHash: () => "h",
    searchSteamGameByName: async () => [],
    chooseBestSteamMatch: () => null,
    fetchSteamPriceDetails: async () => null,
    extractSteamOfferEndDate: async () => null,
    safeCheerioLoad: () => ({} as any),
    getSystemTimes: async () => ({ all: 35000, single: 2000, reduceri: 10000 }),
    saveSystemTime: async () => undefined,
    saveSystemTimes: async () => undefined,
    crypto: { randomBytes: () => ({ toString: () => "abc" }) },
    MAX_DEALS: 10,
    COMMAND_OUTPUT_MAX_CHARS: 1900,
    DEALS_HISTORY_LIMIT: 300,
    OP_UPDATE_OPTS: {},
    CACHE_TTL_MS: 180_000,
    SINGLE_CACHE_MAX_SIZE: 100,
    DLC_CACHE_MAX_SIZE: 100,
    ITEMS_PER_PAGE: 5,
    DLC_ITEMS_PER_PAGE: 10
  };
}

function makeSetInteraction(opts: {
  group: string | null;
  sub: string;
  optionGetter?: (name: string, type: "string" | "integer" | "role") => unknown;
}) {
  return {
    guild: { id: "guild-1" },
    options: {
      getSubcommandGroup: () => opts.group,
      getSubcommand: () => opts.sub,
      getString: (name: string) => opts.optionGetter?.(name, "string") ?? null,
      getInteger: (name: string) => opts.optionGetter?.(name, "integer") ?? null,
      getRole: (name: string) => opts.optionGetter?.(name, "role") ?? null
    },
    deferred: false,
    replied: false
  };
}

test("/set with unknown sub returns an error instead of writing empty $set", async () => {
  // V11 regression guard: previously this would call
  // `GuildModel.updateOne({_id}, { $set: {} }, { upsert: true })` and on a
  // new guild would create an empty document with only `_id`.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls);
  attachInteractions(ctx);

  await ctx.handleSetInteraction(
    makeSetInteraction({ group: null, sub: "future-feature" }),
    []
  );

  assert.equal(mongoCalls.length, 0, "no Mongo write must happen for an unknown /set sub");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]),
    /Subcomanda `\/set future-feature` nu este recunoscuta/,
    "user should see a clear error naming the unknown sub");
});

test("/set games with unknown sub replies to the user instead of leaving the interaction hanging", async () => {
  // V11 regression guard: the legacy router's handleSetGames used to drop off
  // the end of the function without calling safeEdit for an unknown sub —
  // user stayed on the deferReply loading state forever.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls);
  attachInteractions(ctx);

  await ctx.handleSetInteraction(
    makeSetInteraction({
      group: "games",
      sub: "experimental",
      // The fallthrough path looks for the `joc` option after the known
      // branches, so this stand-in just returns a known game key to make
      // sure we don't bail on "necunoscut" path before reaching the new
      // guard at the end.
      optionGetter: (name) => name === "joc" ? "cs2" : null
    }),
    [{ key: "cs2", name: "Counter-Strike 2" }]
  );

  assert.equal(mongoCalls.length, 0, "no Mongo write must happen for an unknown /set games sub");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]),
    /Subcomanda `\/set games experimental` nu este recunoscuta/,
    "user should see a clear error naming the unknown sub");
});

test("/set role with unknown sub does not silently target discountRoleId", async () => {
  // V11 regression guard: the old `sub === "updates" ? notificationRoleId :
  // discountRoleId` default meant ANY unknown sub silently wrote to
  // discountRoleId. Confusing and dangerous if a typo'd sub somehow
  // reached this branch.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls);
  attachInteractions(ctx);

  await ctx.handleSetInteraction(
    makeSetInteraction({
      group: "role",
      sub: "alerts", // Not a known sub.
      optionGetter: (name, type) => type === "role" ? { id: "role-999" } : null
    }),
    []
  );

  assert.equal(mongoCalls.length, 0, "no Mongo write must happen for an unknown /set role sub");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]),
    /Subcomanda `\/set role alerts` nu este recunoscuta/,
    "user should see a clear error naming the unknown sub");
});

test("/set role with known sub still works (regression for the new guard)", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls);
  attachInteractions(ctx);

  await ctx.handleSetInteraction(
    makeSetInteraction({
      group: "role",
      sub: "updates",
      optionGetter: (name, type) => type === "role" ? { id: "role-42" } : null
    }),
    []
  );

  assert.equal(mongoCalls.length, 1, "set role updates must still write");
  const [filter, update] = mongoCalls[0] as [Record<string, unknown>, Record<string, any>];
  assert.deepEqual(filter, { _id: "guild-1" });
  assert.equal(update.$set.notificationRoleId, "role-42");
  assert.match(String(replies[0]), /Rol pentru update-uri:/);
});
