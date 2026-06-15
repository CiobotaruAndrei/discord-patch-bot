import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type Installer = (context: Record<string, unknown>) => void;

type SourceRegistryExports = {
  createSourceRegistry: (
    context: Record<string, unknown>,
    installers: Installer[]
  ) => SourceRegistryRuntime;
};
type SourceRegistryRuntime = Record<string, unknown> & {
  cleanText: (value: string) => string;
  httpReq: () => string;
  searchSteamGameByName: () => string;
  getLatestForAllGames: () => string;
  fetchDeals: () => string;
  dealHash: (deal: { id: string }) => string;
  MAX_DEALS: number;
};

const sourceRegistry = require("../sources/sourceRegistry") as SourceRegistryExports;

test("source registry can be created with explicit mocked installers", () => {
  const calls: string[] = [];
  const baseContext: Record<string, unknown> = {
    USER_AGENTS: ["test-agent"],
    MAX_HTML_BYTES: 1024,
    MAX_JSON_BYTES: 2048,
    MAX_DEALS: 3,
    FETCH_CONCURRENCY: 2,
    formatPrice: (amount: number) => `$${amount}`
  };
  const installers: Installer[] = [
    context => {
      calls.push("http");
      context.cleanText = (value: unknown) => String(value).trim();
      context.truncate = (value: unknown) => String(value);
      context.normalizeTitleForDedupe = (value: unknown) => String(value);
      context.stableUpdateId = () => "id";
      context.normalizeUpdate = (data: unknown) => data;
      context.safeCheerioLoad = () => "cheerio";
      context.levenshtein = () => 0;
      context.httpReq = () => "http-result";
      context.fetchWithProxy = () => "proxy-result";
      context.dealHash = (deal: { id: string }) => deal.id;
      context.attachMetrics = () => undefined;
    },
    context => {
      calls.push("steam");
      context.searchSteamGameByName = () => "steam-search";
      context.chooseBestSteamMatch = () => "best-match";
      context.fetchSteamPriceDetails = () => "price-details";
      context.extractOfferEndFromHtml = () => "offer-end";
      context.extractSteamOfferEndDate = () => "offer-end-date";
    },
    context => {
      calls.push("updates");
      context.fetchGameUpdate = () => "game-update";
      context.executeFetchWithCircuitBreaker = () => "cb-fetch";
      context.getLatestForAllGames = () => "latest-games";
    },
    context => {
      calls.push("deals");
      context.fetchSteamReviewData = () => "reviews";
      context.fetchDeals = () => "deals";
      context.enrichDealData = () => "enriched";
      context.cleanEnrichedCache = () => undefined;
      context.getEnrichedCacheSize = () => 0;
    }
  ];

  const registry = sourceRegistry.createSourceRegistry(baseContext, installers);

  assert.deepEqual(calls, ["http", "steam", "updates", "deals"]);
  assert.equal(registry.cleanText("  text  "), "text");
  assert.equal(registry.httpReq(), "http-result");
  assert.equal(registry.searchSteamGameByName(), "steam-search");
  assert.equal(registry.getLatestForAllGames(), "latest-games");
  assert.equal(registry.fetchDeals(), "deals");
  assert.equal(registry.dealHash({ id: "deal-1" }), "deal-1");
  assert.equal(registry.MAX_DEALS, 3);
});

test("createSourceRegistry arunca fail-fast cand un installer mock nu acopera un export (review #9.4)", () => {
  const incompleteContext: Record<string, unknown> = {
    USER_AGENTS: ["test-agent"],
    MAX_HTML_BYTES: 1024
  };
  assert.throws(
    () => sourceRegistry.createSourceRegistry(incompleteContext, [context => { context.cleanText = () => ""; }]),
    /sourceRegistry/,
    "un context incomplet nu mai poate produce un registry cu functii undefined"
  );
});

test("createSourceRegistry nu muteaza modulul runtime partajat (context proaspat per registry)", () => {
  const runtimeModule = require("../sources/runtime") as Record<string, unknown>;
  const installerKeys = ["httpReq", "fetchDeals", "getLatestForAllGames", "searchSteamGameByName"];
  const before = Object.keys(runtimeModule).sort();
  const sourceRegistryFull = require("../sources/sourceRegistry") as {
    createSourceRegistry: (context?: Record<string, unknown>, installers?: Installer[]) => SourceRegistryRuntime;
  };

  const registry = sourceRegistryFull.createSourceRegistry();

  assert.equal(typeof registry.fetchDeals, "function",
    "build-ul default produce un registry cu API-ul complet");
  assert.deepEqual(Object.keys(runtimeModule).sort(), before,
    "modulul runtime partajat nu trebuie sa capete chei noi dupa un build");
  for (const key of installerKeys) {
    assert.equal(key in runtimeModule, false,
      `cheia de installer '${key}' nu trebuie sa ajunga pe singletonul runtime (installer-ele muta o copie)`);
  }
});
