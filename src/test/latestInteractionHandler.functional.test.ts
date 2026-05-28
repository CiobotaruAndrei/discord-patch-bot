import test from "node:test";
import assert from "node:assert/strict";

const installLatestHandler = require("../features/command-handlers/latestInteractionHandler") as
  ((ctx: Record<string, any>) => void) & { createLatestInteractionHandler?: (deps: any) => any };

type Recorded = { name: string; args: unknown[] };

function makeInteraction(opts: {
  sub: string;
  joc?: string | null;
  ephemeralReply?: (payload: unknown) => Promise<unknown>;
}) {
  return {
    commandName: "latest",
    guild: { id: "guild-1" },
    user: { id: "user-99" },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => opts.sub,
      getString: (name: string) => (name === "joc" ? (opts.joc ?? null) : null)
    },
    reply: opts.ephemeralReply || (async () => undefined),
    followUp: async () => undefined
  };
}

function makeCtx(overrides: Partial<Record<string, any>> = {}) {
  const calls: Recorded[] = [];
  const log = (name: string, ...args: unknown[]) => { calls.push({ name, args }); };

  const safeEditPayloads: unknown[] = [];

  const buildEmbedStub = () => ({ setFooter: () => ({}) });

  const ctx: Record<string, any> = {
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => {
      safeEditPayloads.push(payload);
      return { id: "msg-1" };
    },
    getUpdatesCacheData: () => null,
    setUpdatesCache: () => undefined,
    getLatestForAllGames: async (games: any[]) => {
      log("getLatestForAllGames", games);
      return games.map((g: any) => ({ game: g, latest: { id: `u-${g.key}`, title: "x" } }));
    },
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    fetchDeals: async (opts: any) => { log("fetchDeals", opts); return [{ id: "d1" }]; },
    enrichDealData: async (d: any) => d,
    dealPassesFilters: () => true,
    findGameAndSuggestion: () => ({ game: { key: "cs2", name: "CS2" }, suggestion: null }),
    executeFetchWithCircuitBreaker: async (game: any) => {
      log("executeFetch", game);
      return { latest: { id: "u-cs2" } };
    },
    cache: { single: new Map() },
    cacheGetLRU: () => null,
    cacheSetLRU: () => undefined,
    CACHE_TTL_MS: 180_000,
    SINGLE_CACHE_MAX_SIZE: 100,
    searchSteamGameByName: async () => [{ id: "100", name: "Demo" }],
    chooseBestSteamMatch: () => ({ id: "100" }),
    fetchSteamPriceDetails: async () => ({ header_image: "h", price_overview: { discount_percent: 0 } }),
    extractSteamOfferEndDate: async () => null,
    buildSteamPriceEmbed: () => ({}),
    getSystemTimes: async () => ({ all: 35000, single: 2000, reduceri: 10000 }),
    saveSystemTime: async () => undefined,
    smoothTime: (est: number) => est,
    getGuildSettings: async () => ({ notificationMode: "detailed", currency: "USD" }),
    formatUserError: (_err: unknown, fallback: string) => fallback,
    buildUpdateEmbed: () => buildEmbedStub(),
    buildDealEmbed: () => buildEmbedStub(),
    handlePagination: async (_msg: unknown, authorId: string) => { log("handlePagination", authorId); },
    DEFAULT_CURRENCY: "USD",
    ITEMS_PER_PAGE: 5,
    MAX_DEALS: 25,
    MessageFlags: { Ephemeral: 64 },
    handleInteraction: async (interaction: any) => { log("delegated", interaction.commandName); }
  };

  for (const [k, v] of Object.entries(overrides)) ctx[k] = v;
  installLatestHandler(ctx);
  return { ctx, calls, safeEditPayloads };
}

test("/latest updates loads + paginates", async () => {
  const { ctx, calls } = makeCtx();
  await ctx.handleInteraction(
    makeInteraction({ sub: "updates" }),
    [{ key: "cs2", name: "CS2" }]
  );
  assert.ok(calls.some(c => c.name === "getLatestForAllGames"));
  assert.ok(calls.some(c => c.name === "handlePagination"));
});

test("/latest reduceri loads + paginates", async () => {
  const { ctx, calls } = makeCtx();
  await ctx.handleInteraction(
    makeInteraction({ sub: "reduceri" }),
    []
  );
  assert.ok(calls.some(c => c.name === "fetchDeals"));
  assert.ok(calls.some(c => c.name === "handlePagination"));
});

test("/latest update <joc> calls executeFetchWithCircuitBreaker when cache empty", async () => {
  const { ctx, calls } = makeCtx();
  await ctx.handleInteraction(
    makeInteraction({ sub: "update", joc: "cs2" }),
    [{ key: "cs2", name: "CS2" }]
  );
  assert.ok(calls.some(c => c.name === "executeFetch"));
});

test("/latest update without `joc` replies with explicit error", async () => {
  let replied: unknown = null;
  const interaction = makeInteraction({
    sub: "update",
    joc: null,
    ephemeralReply: async (p: unknown) => { replied = p; return undefined; }
  });
  const { ctx, calls } = makeCtx();
  await ctx.handleInteraction(interaction, [{ key: "cs2", name: "CS2" }]);
  assert.match(String((replied as any)?.content), /Trebuie sa specifici un joc/);
  assert.ok(!calls.some(c => c.name === "executeFetch"), "trebuie SA NU faca fetch fara joc");
});

test("/latest pret <joc> calls searchSteamGameByName + buildSteamPriceEmbed", async () => {
  const buildCalls: unknown[] = [];
  const { ctx } = makeCtx({
    buildSteamPriceEmbed: (...args: unknown[]) => { buildCalls.push(args); return {}; }
  });
  await ctx.handleInteraction(
    makeInteraction({ sub: "pret", joc: "Demo" }),
    []
  );
  assert.equal(buildCalls.length, 1);
});

test("/latest pret without `joc` replies with explicit error", async () => {
  let replied: unknown = null;
  const interaction = makeInteraction({
    sub: "pret",
    joc: null,
    ephemeralReply: async (p: unknown) => { replied = p; return undefined; }
  });
  const { ctx } = makeCtx();
  await ctx.handleInteraction(interaction, []);
  assert.match(String((replied as any)?.content), /Trebuie sa specifici un joc/);
});

test("/latest with unknown sub returns ephemeral error reply", async () => {
  let replied: unknown = null;
  const interaction = makeInteraction({
    sub: "future-feature",
    ephemeralReply: async (p: unknown) => { replied = p; return undefined; }
  });
  const { ctx } = makeCtx();
  await ctx.handleInteraction(interaction, []);
  assert.match(String((replied as any)?.content), /Subcomanda `\/latest future-feature` nu este recunoscuta/);
});

test("non-/latest commands are delegated to next handler", async () => {
  const { ctx, calls } = makeCtx();
  const pingInteraction = {
    commandName: "ping",
    guild: { id: "guild-1" },
    user: { id: "u" },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    options: { getSubcommand: () => "", getString: () => null },
    reply: async () => undefined,
    followUp: async () => undefined
  };
  await ctx.handleInteraction(pingInteraction, []);
  assert.ok(calls.some(c => c.name === "delegated" && c.args[0] === "ping"));
});

test("/latest updates with enabledGames filter returns no_data when game not enabled", async () => {
  let editArg: unknown = null;
  const { ctx } = makeCtx({
    getGuildSettings: async () => ({ enabledGames: ["other_game"], notificationMode: "detailed", currency: "USD" }),
    safeEdit: async (_int: unknown, payload: unknown) => { editArg = payload; return { id: "msg" }; }
  });
  await ctx.handleInteraction(
    makeInteraction({ sub: "updates" }),
    [{ key: "cs2", name: "CS2" }]
  );
  assert.match(String(editArg), /Nu am date disponibile pentru jocurile active/);
});

test("/latest reduceri returns no_data when dealPassesFilters drops everything", async () => {
  let editArg: unknown = null;
  const { ctx } = makeCtx({
    dealPassesFilters: () => false,
    safeEdit: async (_int: unknown, payload: unknown) => { editArg = payload; return { id: "msg" }; }
  });
  await ctx.handleInteraction(
    makeInteraction({ sub: "reduceri" }),
    []
  );
  assert.match(String(editArg), /Nu am gasit oferte care sa corespunda/);
});
