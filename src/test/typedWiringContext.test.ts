import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-typed-wiring";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";

const mongoContext = (await import("../infra/mongo/mongoContext.js")).default;
const sourceRegistry = await import("../sources/sourceRegistry.js");

const MONGO_CONTEXT_KEYS = [
  "logger", "env", "withMongoRetry", "GuildModel", "NotificationOutboxModel", "NotificationOutboxSentModel",
  "NotificationHistoryModel", "FeedbackReportModel", "adminAlert", "getGuildSettings",
  "SUPPORTED_CURRENCIES", "DEFAULT_CURRENCY", "formatPrice", "requestContext"
];

const SOURCE_REGISTRY_KEYS = [
  "USER_AGENTS", "cleanText", "httpReq", "fetchWithProxy", "dealHash", "fetchGameUpdate",
  "getLatestForAllGames", "executeFetchWithCircuitBreaker", "enrichDealData", "fetchDeals",
  "searchSteamGameByName", "fetchSteamPriceDetails", "fetchSteamCurrentPlayers", "cleanEnrichedCache", "getEnrichedCacheSize", "formatPrice"
];

test("mongoContext expune toate cheile contractului tipat, niciuna undefined", () => {
  for (const key of MONGO_CONTEXT_KEYS) {
    assert.notEqual((mongoContext as Record<string, unknown>)[key], undefined, `mongoContext.${key} trebuie definit (bag tipat -> citiri typo-safe + assertNoUndefinedExports la boot)`);
  }
});

test("sourceRegistry expune toate cheile contractului tipat, niciuna undefined", () => {
  for (const key of SOURCE_REGISTRY_KEYS) {
    assert.notEqual((sourceRegistry as Record<string, unknown>)[key], undefined, `sourceRegistry.${key} trebuie definit`);
  }
});

test("contextele de wiring expun functii apelabile pentru cheile-functie cheie", () => {
  for (const key of ["withMongoRetry", "adminAlert", "getGuildSettings"]) {
    assert.equal(typeof (mongoContext as Record<string, unknown>)[key], "function", `mongoContext.${key} e functie`);
  }
  for (const key of ["cleanText", "httpReq", "fetchDeals", "getLatestForAllGames", "dealHash"]) {
    assert.equal(typeof (sourceRegistry as Record<string, unknown>)[key], "function", `sourceRegistry.${key} e functie`);
  }
});
