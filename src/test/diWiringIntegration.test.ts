import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-di-wiring";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";
process.env.METRICS_PUBLIC = process.env.METRICS_PUBLIC || "true";

const commandRegistry = (await import("../features/command-registry/commandRegistry.js")).default;
const commandRuntimeContext = require("../features/command-runtime/commandRuntimeContext").default as {
  createCommandRuntimeContext: () => { discord: Record<string, unknown>; mongo: Record<string, unknown>; sources: Record<string, unknown>; platform: Record<string, unknown> };
};

const REQUIRED_REGISTRY_FUNCTIONS = [
  "cleanCache", "getCacheSizes", "setGlobalCacheTtl", "setUpdatesCache", "setDealsCache",
  "checkForUpdates", "checkForDiscounts", "drainOutbox", "buildOptimizedGameList",
  "registerSlashCommands", "buildSlashCommandDefinitions", "handleInteraction",
  "buildHelpEmbed", "findGameAndSuggestion", "getFindGameCacheSize", "clearFindGameCache", "formatUserError",
  "canSendEmbeds"
];

const CRITICAL_CONTEXT_DEPS = [
  "GuildModel", "NotificationOutboxModel", "NotificationOutboxSentModel",
  "getGuildSettings", "invalidateGuildCache", "withMongoRetry", "adminAlert",
  "getCurrencyConfig", "formatPrice",
  "fetchDeals", "getLatestForAllGames", "enrichDealData", "fetchSteamPriceDetails",
  "fetchSteamCurrentPlayers", "searchSteamGameByName", "dealHash", "httpReq", "safeCheerioLoad", "fetchGameUpdate",
  "checkReadMessageHistory", "checkChannelPermissions", "EmbedBuilder"
];

test("wiring DI: lantul complet (mongoContext -> sourceRegistry -> commandRegistry) se incarca si expune cele 18 functii de registru", () => {
  for (const fn of REQUIRED_REGISTRY_FUNCTIONS) {
    assert.equal(typeof (commandRegistry as Record<string, unknown>)[fn], "function", `commandRegistry trebuie sa expuna functia ${fn} (wiring rupt daca lipseste)`);
  }
});

test("wiring DI: contextul de comenzi asamblat expune toate deps critice pentru handler-e (mongo + surse + prezentare), niciuna undefined", () => {
  const ctx = commandRuntimeContext.createCommandRuntimeContext();
  const grouped: Record<string, unknown> = { ...ctx.discord, ...ctx.mongo, ...ctx.sources, ...ctx.platform };
  const missing = CRITICAL_CONTEXT_DEPS.filter(dep => grouped[dep] === undefined);
  assert.deepEqual(missing, [], `deps critice negasite in contextul de comenzi (gap de wiring mongo/surse): ${missing.join(", ")}`);
});
