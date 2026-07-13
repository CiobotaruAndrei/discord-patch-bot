import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type SourceRegistryRuntime = Record<string, unknown>;
type SourceRegistryExports = {
  createSourceRegistry: () => SourceRegistryRuntime;
};

const sourceRegistry = await import("../sources/sourceRegistry.js");

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
];

test("source registry compune explicit toate exporturile prin factory-urile reale (fara installers dinamici)", () => {
  const registry = sourceRegistry.createSourceRegistry();
  for (const key of requiredKeys) {
    assert.ok((registry as Record<string, unknown>)[key] !== undefined, `registry expune ${key} dupa compunerea explicita (http -> steam -> updates -> deals)`);
  }
  for (const fn of ["cleanText", "httpReq", "searchSteamGameByName", "fetchSteamCurrentPlayers", "getLatestForAllGames", "fetchDeals", "dealHash"]) {
    assert.equal(typeof (registry as Record<string, unknown>)[fn], "function", `${fn} e o functie pe registry-ul compus`);
  }
});

test("createSourceRegistry nu muteaza modulul runtime partajat (context proaspat per registry)", () => {
  const runtimeModule = require("../sources/runtime").default as Record<string, unknown>;
  const installerKeys = ["httpReq", "fetchDeals", "getLatestForAllGames", "searchSteamGameByName"];
  const before = Object.keys(runtimeModule).sort();

  const registry = sourceRegistry.createSourceRegistry();

  assert.equal(typeof registry.fetchDeals, "function",
    "build-ul default produce un registry cu API-ul complet");
  assert.deepEqual(Object.keys(runtimeModule).sort(), before,
    "modulul runtime partajat nu trebuie sa capete chei noi dupa un build");
  for (const key of installerKeys) {
    assert.equal(key in runtimeModule, false,
      `cheia adaugata de un modul de sursa ('${key}') nu trebuie sa ajunga pe singletonul runtime (compunerea muta o copie proaspata)`);
  }
});
