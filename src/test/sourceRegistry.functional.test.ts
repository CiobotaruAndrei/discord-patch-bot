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
      context.httpReq = () => "http-result";
      context.fetchWithProxy = () => "proxy-result";
    },
    context => {
      calls.push("steam");
      context.searchSteamGameByName = () => "steam-search";
      context.extractOfferEndFromHtml = () => "offer-end";
    },
    context => {
      calls.push("updates");
      context.fetchGameUpdate = () => "game-update";
      context.getLatestForAllGames = () => "latest-games";
    },
    context => {
      calls.push("deals");
      context.fetchDeals = () => "deals";
      context.enrichDealData = () => "enriched";
      context.dealHash = (deal: { id: string }) => deal.id;
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
