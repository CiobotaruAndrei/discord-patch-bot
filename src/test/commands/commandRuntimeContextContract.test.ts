import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const commandRuntimeContextModule = (await import("../../features/command-runtime/commandRuntimeContext.js")).default;
const { createCommandRuntimeContext, createCommandRuntimeDependencies } = commandRuntimeContextModule;
const { commandRuntimeInput } = await import("./commandTestInput.js");

const CURATED_PRESENT = [
  "logger", "env", "getGuildSettings", "GuildModel", "GuildAuditLogModel", "adminAlert",
  "DEFAULT_CURRENCY", "SUPPORTED_CURRENCIES", "formatPrice", "runConcurrent",
  "fetchDeals", "fetchGameUpdate", "getLatestForAllGames", "cleanText", "MAX_DEALS",
  "EmbedBuilder", "PermissionsBitField", "redis", "checkChannelPermissions"
];

const UNCURATED_MONGO_ABSENT = [
  "runMigrations", "ALL_MIGRATIONS", "acquireDbLock", "renewDbLock", "releaseDbLock", "activeLocks",
  "SchemaDriftError", "parseEnvNumber", "waitForMongoReady", "isTransientMongoError",
  "setAdminAlertDiscordClient", "requestContext", "getAbortSignal", "JobLockModel", "SystemModel",
  "AdminAlertCooldownModel", "CircuitBreakerModel", "FetchSnapshotModel", "saveSystemTimes", "cleanGuildCache"
];

const UNCURATED_SOURCE_ABSENT = [
  "USER_AGENTS", "MAX_HTML_BYTES", "MAX_JSON_BYTES", "levenshtein", "attachMetrics",
  "stableUpdateId", "normalizeUpdate", "absoluteUrl", "isGoodSteamArticleUrl", "sourceConcurrencyGroup"
];

function flattenedKeysForAssertions(): Record<string, unknown> {
  const dependencies = createCommandRuntimeContext(commandRuntimeInput);
  return { ...dependencies.discord, ...dependencies.mongo, ...dependencies.sources, ...dependencies.platform };
}

test("commandRuntimeContext expune contractul curat de comenzi (review 16-iteme #4)", () => {
  const ctx = flattenedKeysForAssertions();
  for (const key of CURATED_PRESENT) {
    assert.ok(key in ctx, `contextul de comenzi trebuie sa expuna campul curat ${key}`);
    assert.notEqual(ctx[key], undefined, `campul curat ${key} nu trebuie sa fie undefined`);
  }
});

test("commandRuntimeContext NU mai scurge suprafata mongo neutilizata (fara ...data wholesale)", () => {
  const ctx = flattenedKeysForAssertions();
  for (const key of UNCURATED_MONGO_ABSENT) {
    assert.ok(!(key in ctx), `god-object regasit: campul mongo necuratat ${key} s-a scurs in contextul de comenzi`);
  }
});

test("commandRuntimeContext NU mai scurge suprafata surselor neutilizata (fara ...scrapers wholesale)", () => {
  const ctx = flattenedKeysForAssertions();
  for (const key of UNCURATED_SOURCE_ABSENT) {
    assert.ok(!(key in ctx), `god-object regasit: campul de surse necuratat ${key} s-a scurs in contextul de comenzi`);
  }
});

test("commandRuntimeDependencies separa Discord, Mongo, sursele si platforma", () => {
  const dependencies = createCommandRuntimeDependencies(commandRuntimeInput);
  assert.deepEqual(Object.keys(dependencies).sort(), ["discord", "mongo", "platform", "sources"]);
  assert.ok("EmbedBuilder" in dependencies.discord);
  assert.ok(!("GuildModel" in dependencies.discord));
  assert.ok("GuildModel" in dependencies.mongo);
  assert.ok(!("fetchDeals" in dependencies.mongo));
  assert.ok("fetchDeals" in dependencies.sources);
  assert.ok(!("redis" in dependencies.sources));
  assert.ok("redis" in dependencies.platform);
  assert.ok(!("logger" in dependencies.platform));
});
