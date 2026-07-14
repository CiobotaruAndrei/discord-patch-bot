import test from "node:test";
import assert from "node:assert/strict";
import type { SourceRegistryApi } from "../../sources/sourceRegistry.js";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const sourceRegistry = await import("../../sources/sourceRegistry.js");

const requiredKeys = [
  "USER_AGENTS",
  "MAX_HTML_BYTES",
  "MAX_JSON_BYTES",
  "MAX_DEALS",
  "FETCH_CONCURRENCY",
  "cleanText",
  "truncate",
  "normalizeTitleForDedupe",
  "stableUpdateId",
  "normalizeUpdate",
  "safeCheerioLoad",
  "levenshtein",
  "httpReq",
  "fetchWithProxy",
  "dealHash",
  "attachMetrics",
  "fetchGameUpdate",
  "executeFetchWithCircuitBreaker",
  "getLatestForAllGames",
  "fetchSteamReviewData",
  "enrichDealData",
  "fetchDeals",
  "searchSteamGameByName",
  "chooseBestSteamMatch",
  "fetchSteamPriceDetails",
  "fetchSteamCurrentPlayers",
  "extractOfferEndFromHtml",
  "extractSteamOfferEndDate",
  "cleanEnrichedCache",
  "getEnrichedCacheSize",
  "formatPrice"
] as const satisfies readonly (keyof SourceRegistryApi)[];

test("source registry compune explicit toate exporturile prin factory-urile reale (fara installers dinamici)", () => {
  const registry = sourceRegistry.createSourceRegistry();
  for (const key of requiredKeys) {
    assert.ok(registry[key] !== undefined, `registry expune ${key} dupa compunerea explicita (http -> steam -> updates -> deals)`);
  }
  const functionKeys = ["cleanText", "httpReq", "searchSteamGameByName", "fetchSteamCurrentPlayers", "getLatestForAllGames", "fetchDeals", "dealHash"] as const;
  for (const fn of functionKeys) {
    assert.equal(typeof registry[fn], "function", `${fn} e o functie pe registry-ul compus`);
  }
});

test("createSourceRegistry construieste un context proaspat per registry", () => {
  const first = sourceRegistry.createSourceRegistry();
  const second = sourceRegistry.createSourceRegistry();

  assert.notStrictEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true);
  assert.deepEqual(Object.keys(first).sort(), Object.keys(second).sort());
  assert.notStrictEqual(first.fetchDeals, second.fetchDeals);
  assert.notStrictEqual(first.getLatestForAllGames, second.getLatestForAllGames);
});
