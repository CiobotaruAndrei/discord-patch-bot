import test from "node:test";
import assert from "node:assert/strict";

import { makeDealInfo } from "./typedTestBuilders";

const realUtilities = require("../shared/utilities") as { validatePendingDiscountSnapshot: (snapshot: unknown) => boolean; validateUpdateFetchSnapshot: (item: unknown) => boolean };

const latestHandlerModule = require("../features/command-handlers/latestInteractionHandler") as {
  createLatestInteractionHandler?: (deps: unknown) => unknown;
  buildCommandHandler: (target: Record<string, unknown>) => {
    canHandle: (interaction: unknown) => boolean;
    handle: (interaction: unknown, games?: TestGame[]) => Promise<unknown>;
  };
};

type Recorded = { name: string; args: unknown[] };
type TestGame = { key: string; name?: string };
type LatestRuntime = {
  handleInteraction: (interaction: unknown, games?: TestGame[]) => Promise<unknown>;
};

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

function makeContext(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: Recorded[] = [];
  const log = (name: string, ...args: unknown[]) => { calls.push({ name, args }); };

  const safeEditPayloads: unknown[] = [];

  const buildEmbedStub = () => ({ setFooter: () => ({}) });

  const context = {
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
    getLatestForAllGames: async (games: TestGame[]) => {
      log("getLatestForAllGames", games);
      return games.map(game => ({ game, latest: { id: `u-${game.key}`, title: "x" } }));
    },
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    fetchDeals: async (opts: unknown) => { log("fetchDeals", opts); return [{ id: "d1" }]; },
    enrichDealData: async (deal: unknown) => deal,
    dealPassesFilters: () => true,
    validatePendingDiscountSnapshot: realUtilities.validatePendingDiscountSnapshot,
    validateUpdateFetchSnapshot: realUtilities.validateUpdateFetchSnapshot,
    findGameAndSuggestion: () => ({ game: { key: "cs2", name: "CS2" }, suggestion: null }),
    executeFetchWithCircuitBreaker: async (game: unknown) => {
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
    handleInteraction: async (interaction: { commandName: string }) => { log("delegated", interaction.commandName); }
  };

  for (const [k, v] of Object.entries(overrides)) (context as Record<string, unknown>)[k] = v;
  const previousHandleInteraction = context.handleInteraction;
  const { canHandle, handle } = latestHandlerModule.buildCommandHandler(context as Record<string, unknown>);
  const chainedHandleInteraction = async (interaction: { commandName: string }, games?: TestGame[]) => {
    if (!canHandle(interaction)) return previousHandleInteraction(interaction);
    return handle(interaction, games);
  };
  (context as Record<string, unknown>).handleInteraction = chainedHandleInteraction;
  return { context: context as typeof context & LatestRuntime, calls, safeEditPayloads };
}

test("/latest updates loads + paginates", async () => {
  const { context, calls } = makeContext();
  await context.handleInteraction(
    makeInteraction({ sub: "updates" }),
    [{ key: "cs2", name: "CS2" }]
  );
  assert.ok(calls.some(c => c.name === "getLatestForAllGames"));
  assert.ok(calls.some(c => c.name === "handlePagination"));
});

test("/latest updates: fetch live picat + snapshot proaspat -> update-urile vin din snapshot, cu banner vizibil (review #449 #1)", async () => {
  const { context, safeEditPayloads } = makeContext({
    getLatestForAllGames: async () => { throw new Error("fetch live picat"); },
    loadFetchSnapshot: async (id: string) => (id === "updates"
      ? { payload: [{ game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2", title: "x" } }], fetchedAt: new Date(Date.now() - 10 * 60000) }
      : null)
  });
  await context.handleInteraction(makeInteraction({ sub: "updates" }), [{ key: "cs2", name: "CS2" }]);
  assert.ok(!safeEditPayloads.some(p => String(p).includes("Nu am reusit sa obtin update-urile")), "fara mesaj de eroare cand exista snapshot proaspat");
  const banner = safeEditPayloads.find(p => String(p).includes("snapshot"));
  assert.ok(banner, "exista un banner care anunta ca update-urile vin din snapshot (simetrie cu /latest reduceri si cron)");
});

test("/latest updates: fetch live picat + fara snapshot -> eroarea ramane explicita (review #449 #1)", async () => {
  const { context, safeEditPayloads } = makeContext({
    getLatestForAllGames: async () => { throw new Error("fetch live picat"); },
    loadFetchSnapshot: async () => null
  });
  await context.handleInteraction(makeInteraction({ sub: "updates" }), [{ key: "cs2", name: "CS2" }]);
  assert.ok(safeEditPayloads.some(p => String(p).includes("Nu am reusit sa obtin update-urile")), "fara snapshot proaspat, eroarea ramane explicita");
});

test("/latest reduceri loads + paginates", async () => {
  const { context, calls } = makeContext();
  await context.handleInteraction(
    makeInteraction({ sub: "reduceri" }),
    []
  );
  assert.ok(calls.some(c => c.name === "fetchDeals"));
  assert.ok(calls.some(c => c.name === "handlePagination"));
});

test("/latest reduceri: fetch live picat + snapshot proaspat -> ofertele vin din snapshot, cu banner vizibil (review #14.2 + #15.3 + #16.3)", async () => {
  const setCacheCalls: unknown[] = [];
  const { context, calls, safeEditPayloads } = makeContext({
    fetchDeals: async () => { throw new Error("ambele magazine picate"); },
    setDealsCache: (currency: string, deals: unknown[]) => { setCacheCalls.push({ currency, deals }); },
    loadFetchSnapshot: async (id: string) => (id === "deals:USD" ? { payload: [makeDealInfo()], fetchedAt: new Date(Date.now() - 10 * 60000) } : null)
  });
  await context.handleInteraction(makeInteraction({ sub: "reduceri" }), []);
  assert.ok(calls.some(c => c.name === "handlePagination"), "ofertele din snapshot (fixture DealInfo complet, validator REAL) se afiseaza");
  assert.ok(!safeEditPayloads.some(p => String(p).includes("Nu am putut interoga magazinele")), "fara mesaj de eroare cand exista snapshot proaspat");
  const banner = safeEditPayloads.find(p => String(p).includes("snapshot"));
  assert.ok(banner, "utilizatorul vede explicit ca datele vin din snapshot, nu live");
  assert.match(String(banner), /vechime ~10 min/, "banner-ul arata vechimea snapshot-ului");
  assert.equal(setCacheCalls.length, 0, "fallback-ul de snapshot NU se scrie in cache-ul live (review #16.1)");

  const second: unknown[] = [];
  const ctx2 = makeContext({
    fetchDeals: async () => { throw new Error("ambele magazine picate"); },
    safeEdit: async (_i: unknown, payload: unknown) => { second.push(payload); return { id: "msg-2" }; },
    loadFetchSnapshot: async () => ({ payload: [makeDealInfo()], fetchedAt: new Date(Date.now() - 10 * 60000) })
  });
  await ctx2.context.handleInteraction(makeInteraction({ sub: "reduceri" }), []);
  assert.ok(second.some(p => String(p).includes("snapshot")), "si al doilea request vede banner-ul, nu un fals OK din cache");
});

test("/latest reduceri: backoff negativ - dupa un esec live, urmatorul request nu mai loveste sursele, merge direct pe snapshot (review #17.4)", async () => {
  let fetchCalls = 0;
  const { context, safeEditPayloads } = makeContext({
    fetchDeals: async () => { fetchCalls++; throw new Error("magazine picate"); },
    loadFetchSnapshot: async () => ({ payload: [makeDealInfo()], fetchedAt: new Date(Date.now() - 5 * 60000) })
  });
  await context.handleInteraction(makeInteraction({ sub: "reduceri" }), []);
  await context.handleInteraction(makeInteraction({ sub: "reduceri" }), []);
  assert.equal(fetchCalls, 1, "al doilea request in fereastra de backoff nu mai incearca fetch-ul live (sursele externe nu sunt lovite sub outage)");
  const banners = safeEditPayloads.filter(p => String(p).includes("snapshot"));
  assert.ok(banners.length >= 2, "ambele request-uri vad banner-ul de snapshot");
});

test("/latest reduceri: snapshot corupt (itemi care nu trec validatorul) -> eroarea explicita, nu render pe date invalide (review #15.2)", async () => {
  const { context, safeEditPayloads } = makeContext({
    fetchDeals: async () => { throw new Error("ambele magazine picate"); },
    loadFetchSnapshot: async () => ({ payload: [{ id: "fara-titlu" }, 42, null], fetchedAt: new Date() })
  });
  await context.handleInteraction(makeInteraction({ sub: "reduceri" }), []);
  assert.ok(safeEditPayloads.some(p => String(p).includes("Nu am putut interoga magazinele")), "snapshot-ul corupt nu ajunge in filtrare/render");
});

test("/latest reduceri: fetch picat si fara snapshot proaspat -> eroarea existenta (review #14.2)", async () => {
  const { context, safeEditPayloads } = makeContext({
    fetchDeals: async () => { throw new Error("ambele magazine picate"); },
    loadFetchSnapshot: async () => null
  });
  await context.handleInteraction(makeInteraction({ sub: "reduceri" }), []);
  assert.ok(safeEditPayloads.some(p => String(p).includes("Nu am putut interoga magazinele")), "fara snapshot, eroarea ramane explicita");
});

test("/latest update <joc> calls executeFetchWithCircuitBreaker when cache empty", async () => {
  const { context, calls } = makeContext();
  await context.handleInteraction(
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
  const { context, calls } = makeContext();
  await context.handleInteraction(interaction, [{ key: "cs2", name: "CS2" }]);
  assert.match(String((replied as { content?: unknown } | null)?.content), /Trebuie sa specifici un joc/);
  assert.ok(!calls.some(c => c.name === "executeFetch"), "trebuie SA NU faca fetch fara joc");
});

test("/latest pret <joc> calls searchSteamGameByName + buildSteamPriceEmbed", async () => {
  const buildCalls: unknown[] = [];
  const { context } = makeContext({
    buildSteamPriceEmbed: (...args: unknown[]) => { buildCalls.push(args); return {}; }
  });
  await context.handleInteraction(
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
  const { context } = makeContext();
  await context.handleInteraction(interaction, []);
  assert.match(String((replied as { content?: unknown } | null)?.content), /Trebuie sa specifici un joc/);
});

test("/latest with unknown sub returns ephemeral error reply", async () => {
  let replied: unknown = null;
  const interaction = makeInteraction({
    sub: "future-feature",
    ephemeralReply: async (p: unknown) => { replied = p; return undefined; }
  });
  const { context } = makeContext();
  await context.handleInteraction(interaction, []);
  assert.match(String((replied as { content?: unknown } | null)?.content), /Subcomanda `\/latest future-feature` nu este recunoscuta/);
});

test("non-/latest commands are delegated to next handler", async () => {
  const { context, calls } = makeContext();
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
  await context.handleInteraction(pingInteraction, []);
  assert.ok(calls.some(c => c.name === "delegated" && c.args[0] === "ping"));
});

test("/latest updates with enabledGames filter returns no_data when game not enabled", async () => {
  let editArg: unknown = null;
  const { context } = makeContext({
    getGuildSettings: async () => ({ enabledGames: ["other_game"], notificationMode: "detailed", currency: "USD" }),
    safeEdit: async (_int: unknown, payload: unknown) => { editArg = payload; return { id: "msg" }; }
  });
  await context.handleInteraction(
    makeInteraction({ sub: "updates" }),
    [{ key: "cs2", name: "CS2" }]
  );
  assert.match(String(editArg), /Nu am date disponibile pentru jocurile active/);
});

test("/latest reduceri returns no_data when dealPassesFilters drops everything", async () => {
  let editArg: unknown = null;
  const { context } = makeContext({
    dealPassesFilters: () => false,
    safeEdit: async (_int: unknown, payload: unknown) => { editArg = payload; return { id: "msg" }; }
  });
  await context.handleInteraction(
    makeInteraction({ sub: "reduceri" }),
    []
  );
  assert.match(String(editArg), /Nu am gasit oferte care sa corespunda/);
});

test("/latest updates: rezultatul integral all-null NU otraveste cache-ul global (audit)", async () => {
  const cacheWrites: unknown[] = [];
  const { context } = makeContext({
    setUpdatesCache: (data: unknown) => { cacheWrites.push(data); },
    getLatestForAllGames: async (games: TestGame[]) => games.map(game => ({ game, latest: null, error: "ECONNRESET" }))
  });
  await context.handleInteraction(makeInteraction({ sub: "updates" }), [{ key: "cs2", name: "CS2" }]);
  assert.equal(cacheWrites.length, 0,
    "regresie: o cadere totala a surselor in timpul comenzii bloca /latest pe <Nu am date disponibile> pana expira TTL-ul, fara refetch");
});

test("/latest updates: rezultatul partial (macar un joc cu date) se cacheaza ca pana acum", async () => {
  const cacheWrites: unknown[] = [];
  const { context } = makeContext({
    setUpdatesCache: (data: unknown) => { cacheWrites.push(data); },
    getLatestForAllGames: async (games: TestGame[]) => games.map((game, idx) => ({ game, latest: idx === 0 ? { id: `u-${game.key}`, title: "x" } : null }))
  });
  await context.handleInteraction(makeInteraction({ sub: "updates" }), [{ key: "cs2", name: "CS2" }, { key: "dota2", name: "Dota" }]);
  assert.equal(cacheWrites.length, 1, "cu date partiale, cache-ul se scrie exact o data");
});
