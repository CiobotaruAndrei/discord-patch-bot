import test from "node:test";
import assert from "node:assert/strict";

type Installer = (ctx: Record<string, any>) => void;

type SourceRegistryExports = {
  createSourceRegistry: (
    context: Record<string, any>,
    installers: Installer[]
  ) => Record<string, any>;
};

const sourceRegistry = require("../sources/sourceRegistry") as SourceRegistryExports;

test("source registry can be created with explicit mocked installers", () => {
  const calls: string[] = [];
  const baseContext: Record<string, any> = {
    USER_AGENTS: ["test-agent"],
    MAX_HTML_BYTES: 1024,
    MAX_JSON_BYTES: 2048,
    MAX_DEALS: 3,
    FETCH_CONCURRENCY: 2,
    formatPrice: (amount: number) => `$${amount}`
  };
  const installers: Installer[] = [
    ctx => {
      calls.push("http");
      ctx.cleanText = (value: unknown) => String(value).trim();
      ctx.httpReq = () => "http-result";
      ctx.fetchWithProxy = () => "proxy-result";
    },
    ctx => {
      calls.push("steam");
      ctx.searchSteamGameByName = () => "steam-search";
      ctx.extractOfferEndFromHtml = () => "offer-end";
    },
    ctx => {
      calls.push("updates");
      ctx.fetchGameUpdate = () => "game-update";
      ctx.getLatestForAllGames = () => "latest-games";
    },
    ctx => {
      calls.push("deals");
      ctx.fetchDeals = () => "deals";
      ctx.enrichDealData = () => "enriched";
      ctx.dealHash = (deal: { id: string }) => deal.id;
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
