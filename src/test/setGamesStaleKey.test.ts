import test from "node:test";
import assert from "node:assert/strict";

// V12: legacy router-ul nu mai expune handlers per-comanda. Folosim handlers
// dedicate cu deps tipate, identic cu install order-ul de productie.
const installGameFilterHandlers = require("../features/command-handlers/gameFilterHandlers") as (ctx: Record<string, any>) => void;
const installStatusHandler = require("../features/command-handlers/statusInteractionHandler") as (ctx: Record<string, any>) => void;
const installSetHandler = require("../features/command-handlers/setInteractionHandler") as (ctx: Record<string, any>) => void;

function attachInteractions(ctx: Record<string, any>): void {
  // Bottom-of-chain stub: handleInteraction nu mai exista in legacy router
  // ca handler complet, deci provideam un default no-op pentru testele care
  // exercita doar handlers individuali prin `ctx.handleSetInteraction(...)`.
  if (typeof ctx.handleInteraction !== "function") {
    ctx.handleInteraction = async () => undefined;
  }
  installGameFilterHandlers(ctx);
  installSetHandler(ctx);
  installStatusHandler(ctx);
}

type Game = { key: string; name: string };

function makeCtx(replies: unknown[], mongoCalls: unknown[][], modifiedCount = 1) {
  return {
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
    GuildModel: {
      updateOne: async (...args: unknown[]) => {
        mongoCalls.push(args);
        return { matchedCount: 1, modifiedCount };
      },
      findById: () => ({ lean: async () => null })
    },
    invalidateGuildCache: () => undefined,
    getGuildSettings: async () => null,
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
    cache: { single: new Map(), dlc: new Map() },
    cacheGetLRU: () => null,
    cacheSetLRU: () => undefined,
    getUpdatesCacheData: () => null,
    setUpdatesCache: () => undefined,
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
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

function makeSetGamesInteraction(sub: string, jocKey: string) {
  return {
    guild: { id: "guild-1" },
    options: {
      getSubcommandGroup: () => "games",
      getSubcommand: () => sub,
      getString: (name: string) => name === "joc" ? jocKey : null,
      getInteger: () => null,
      getRole: () => null
    },
    deferred: false,
    replied: false
  };
}

test("/set games remove accepts a stale key not in the current config", async () => {
  // V11 regression guard: previously `/set games remove old-game` would fail
  // with "Cheia `old-game` nu exista in config" if the operator deleted the
  // game from config.json — leaving the guild's enabledGames stuck with the
  // stale entry forever. Now $pull runs regardless and confirms.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls, /* modifiedCount */ 1);
  attachInteractions(ctx);

  const currentGames: Game[] = [{ key: "cs2", name: "Counter-Strike 2" }];
  await ctx.handleSetGames(
    makeSetGamesInteraction("remove", "old-removed-game"),
    currentGames,
    "remove",
    "guild-1"
  );

  assert.equal(mongoCalls.length, 1,
    "the $pull must run even when the key is not in the current config");
  const [filter, update] = mongoCalls[0] as [Record<string, unknown>, Record<string, any>];
  assert.deepEqual(filter, { _id: "guild-1" });
  assert.deepEqual(update.$pull, { enabledGames: "old-removed-game" });
  assert.match(String(replies[0]),
    /scos din lista activa.*cheie nu mai exista in config/,
    "user should see a clear note that the key was stale-cleaned");
});

test("/set games remove reports 'nothing to remove' when key was not in enabledGames", async () => {
  // Even with the new permissive remove, if the $pull modified nothing
  // (key wasn't in enabledGames in the first place) we surface that as
  // Info to the user rather than a misleading "OK" success.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls, /* modifiedCount */ 0);
  attachInteractions(ctx);

  await ctx.handleSetGames(
    makeSetGamesInteraction("remove", "cs2"),
    [{ key: "cs2", name: "Counter-Strike 2" }],
    "remove",
    "guild-1"
  );

  assert.equal(mongoCalls.length, 1);
  assert.match(String(replies[0]),
    /nu era in lista activa, nimic de scos/,
    "user should see a clear info message when nothing was actually removed");
});

test("/set games add still rejects keys not in the current config", async () => {
  // Regression guard for the asymmetry — `add` keeps strict validation
  // because we don't want random typed strings polluting enabledGames.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls);
  attachInteractions(ctx);

  await ctx.handleSetGames(
    makeSetGamesInteraction("add", "no-such-game"),
    [{ key: "cs2", name: "Counter-Strike 2" }],
    "add",
    "guild-1"
  );

  assert.equal(mongoCalls.length, 0, "add must NOT write a stale key to Mongo");
  assert.match(String(replies[0]),
    /Cheia `no-such-game` nu exista in config/,
    "add should still produce the strict 'not in config' error");
});

test("/status with empty joc replies with a friendly error before doing any work", async () => {
  // V11 regression guard: previously the loading state read "Se incarca:
  // ... pentru **null**..." because gameText wasn't validated. Now we bail
  // before deferring.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx: any = makeCtx(replies, mongoCalls);
  attachInteractions(ctx);

  let directReplyPayload: any = null;
  const interaction: any = {
    guild: { id: "guild-1" },
    options: {
      getString: () => null
    },
    deferred: false,
    replied: false,
    reply: async (payload: any) => { directReplyPayload = payload; return payload; }
  };

  await ctx.handleStatusInteraction(interaction, []);

  assert.equal(replies.length, 0,
    "we should NOT call safeEdit (no defer happened, no loading message)");
  assert.ok(directReplyPayload, "expected a direct reply()");
  assert.match(String(directReplyPayload.content),
    /Trebuie sa specifici un joc/,
    "the reply should ask the user to specify a game");
});
