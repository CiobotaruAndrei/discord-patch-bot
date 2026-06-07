import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-typed-wiring";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";

const mongoContext = require("../infra/mongo/mongoContext") as Record<string, unknown>;
const sourceRegistry = require("../sources/sourceRegistry") as Record<string, unknown>;

const MONGO_CONTEXT_KEYS = [
  "logger", "env", "withMongoRetry", "GuildModel", "NotificationOutboxModel", "NotificationOutboxSentModel",
  "NotificationHistoryModel", "FeedbackReportModel", "adminAlert", "getGuildSettings", "invalidateGuildCache",
  "SUPPORTED_CURRENCIES", "DEFAULT_CURRENCY", "formatPrice", "requestContext"
];

const SOURCE_REGISTRY_KEYS = [
  "USER_AGENTS", "cleanText", "httpReq", "fetchWithProxy", "dealHash", "fetchGameUpdate",
  "getLatestForAllGames", "executeFetchWithCircuitBreaker", "enrichDealData", "fetchDeals",
  "searchSteamGameByName", "fetchSteamPriceDetails", "cleanEnrichedCache", "getEnrichedCacheSize", "formatPrice"
];

test("mongoContext expune toate cheile contractului tipat, niciuna undefined", () => {
  for (const key of MONGO_CONTEXT_KEYS) {
    assert.notEqual(mongoContext[key], undefined, `mongoContext.${key} trebuie definit (bag tipat -> citiri typo-safe + assertNoUndefinedExports la boot)`);
  }
});

test("sourceRegistry expune toate cheile contractului tipat, niciuna undefined", () => {
  for (const key of SOURCE_REGISTRY_KEYS) {
    assert.notEqual(sourceRegistry[key], undefined, `sourceRegistry.${key} trebuie definit`);
  }
});

test("contextele de wiring expun functii apelabile pentru cheile-functie cheie", () => {
  for (const key of ["withMongoRetry", "adminAlert", "getGuildSettings"]) {
    assert.equal(typeof mongoContext[key], "function", `mongoContext.${key} e functie`);
  }
  for (const key of ["cleanText", "httpReq", "fetchDeals", "getLatestForAllGames", "dealHash"]) {
    assert.equal(typeof sourceRegistry[key], "function", `sourceRegistry.${key} e functie`);
  }
});
