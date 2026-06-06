import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-di-wiring";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";
process.env.METRICS_PUBLIC = process.env.METRICS_PUBLIC || "true";

const commandRegistry = require("../features/command-registry/commandRegistry") as Record<string, unknown>;
const commandRuntimeContext = require("../features/command-runtime/commandRuntimeContext") as {
  createCommandRuntimeContext: () => Record<string, unknown>;
};

const REQUIRED_REGISTRY_FUNCTIONS = [
  "cleanCache", "getCacheSizes", "setGlobalCacheTtl", "setUpdatesCache", "setDealsCache",
  "checkForUpdates", "checkForDiscounts", "drainOutbox", "buildOptimizedGameList",
  "registerSlashCommands", "buildSlashCommandDefinitions", "handleInteraction",
  "buildHelpEmbed", "findGameAndSuggestion", "getFindGameCacheSize", "clearFindGameCache", "formatUserError"
];

const CRITICAL_CONTEXT_DEPS = [
  "GuildModel", "NotificationOutboxModel", "NotificationOutboxSentModel",
  "getGuildSettings", "invalidateGuildCache", "withMongoRetry", "adminAlert",
  "getCurrencyConfig", "formatPrice",
  "fetchDeals", "getLatestForAllGames", "enrichDealData", "fetchSteamPriceDetails",
  "searchSteamGameByName", "dealHash", "httpReq", "safeCheerioLoad", "fetchGameUpdate",
  "checkReadMessageHistory", "checkChannelPermissions", "EmbedBuilder"
];

test("wiring DI: lantul complet (mongoContext -> sourceRegistry -> commandRegistry) se incarca si expune cele 17 functii de registru", () => {
  for (const fn of REQUIRED_REGISTRY_FUNCTIONS) {
    assert.equal(typeof commandRegistry[fn], "function", `commandRegistry trebuie sa expuna functia ${fn} (wiring rupt daca lipseste)`);
  }
});

test("wiring DI: contextul de comenzi asamblat expune toate deps critice pentru handler-e (mongo + surse + prezentare), niciuna undefined", () => {
  const ctx = commandRuntimeContext.createCommandRuntimeContext();
  const missing = CRITICAL_CONTEXT_DEPS.filter(dep => ctx[dep] === undefined);
  assert.deepEqual(missing, [], `deps critice negasite in contextul de comenzi (gap de wiring mongo/surse): ${missing.join(", ")}`);
});
