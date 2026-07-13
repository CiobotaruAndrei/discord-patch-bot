import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "../commandChainTestKit.js";
import assert from "node:assert/strict";

import installGameFilterHandlers from "../../features/command-handlers/gameFilterHandlers.js";
import installStatusHandler from "../../features/command-handlers/statusInteractionHandler.js";
import installSetHandler from "../../features/command-handlers/setInteractionHandler.js";

function attachInteractions(context: Record<string, unknown>): void {

  if (typeof context.handleInteraction !== "function") {
    context.handleInteraction = async () => undefined;
  }
  installCommandChain(context, [installGameFilterHandlers, installSetHandler, installStatusHandler] as object as ChainableCommandModule[]);
}

type Game = { key: string; name: string };
type InteractionRuntime = {
  handleSetGames: (interaction: unknown, games: Game[], sub: string, guildId: string) => Promise<unknown>;
  handleStatusInteraction: (interaction: unknown, games: Game[]) => Promise<unknown>;
};

function makeContext(replies: unknown[], mongoCalls: unknown[][], modifiedCount = 1) {
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
    safeCheerioLoad: () => ({}),
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
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls,  1) as ReturnType<typeof makeContext> & InteractionRuntime;
  attachInteractions(context);

  const currentGames: Game[] = [{ key: "cs2", name: "Counter-Strike 2" }];
  await context.handleSetGames(
    makeSetGamesInteraction("remove", "old-removed-game"),
    currentGames,
    "remove",
    "guild-1"
  );

  assert.equal(mongoCalls.length, 1,
    "the $pull must run even when the key is not in the current config");
  const [filter, update] = mongoCalls[0] as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual(filter, { _id: "guild-1" });
  assert.deepEqual(update.$pull, { enabledGames: "old-removed-game" });
  assert.match(String(replies[0]),
    /scos din watchlist.*cheie nu mai exista in config/,
    "user should see a clear note that the key was stale-cleaned");
});

test("/set games remove reports 'nothing to remove' when key was not in enabledGames", async () => {

  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls,  0) as ReturnType<typeof makeContext> & InteractionRuntime;
  attachInteractions(context);

  await context.handleSetGames(
    makeSetGamesInteraction("remove", "cs2"),
    [{ key: "cs2", name: "Counter-Strike 2" }],
    "remove",
    "guild-1"
  );

  assert.equal(mongoCalls.length, 1);
  assert.match(String(replies[0]),
    /nu era in watchlist, nimic de scos/,
    "user should see a clear info message when nothing was actually removed");
});

test("/set games add still rejects keys not in the current config", async () => {

  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls) as ReturnType<typeof makeContext> & InteractionRuntime;
  attachInteractions(context);

  await context.handleSetGames(
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

test("/status with empty joc replies with a friendly error before doing extra work", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls) as ReturnType<typeof makeContext> & InteractionRuntime;
  attachInteractions(context);

  let directReplyPayload: { content?: unknown } | null = null;
  const interaction = {
    guild: { id: "guild-1" },
    options: {
      getString: () => null
    },
    deferred: false,
    replied: false,
    reply: async (payload: { content?: unknown }) => { directReplyPayload = payload; return payload; }
  };

  await context.handleStatusInteraction(interaction, []);

  assert.equal(replies.length, 0,
    "we should NOT call safeEdit (no defer happened, no loading message)");
  const directReply = directReplyPayload as { content?: unknown } | null;
  assert.ok(directReply, "expected a direct reply()");
  assert.match(String(directReply?.content),
    /Trebuie sa specifici un joc/,
    "the reply should ask the user to specify a game");
});
