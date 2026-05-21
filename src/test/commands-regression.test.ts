// @ts-check
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const commandFiles = [
  "features/commands/cache.js",
  "domain/deals/filters.js",
  "features/commands/ui.js",
  "features/notifications/outboundChannel.js",
  "features/notifications/index.js",
  "features/commands/slashCommands.js",
  "features/commands/interactions.js"
];
const runtimeFiles = [
  "config/configLoader.js",
  "shared/domain.js",
  "shared/env.js",
  "shared/utilities.js",
  "shared/logging.js",
  "infra/http/client.js",
  "infra/mongo/guildSettings.js",
  "infra/mongo/adminAlerts.js",
  "infra/mongo/locks.js",
  "infra/mongo/migrations.js",
  "infra/mongo/systemState.js",
  "sources/steam/index.js",
  "sources/deals/index.js",
  "sources/updates/index.js",
  "app/scheduler/cron.js",
  "app/lifecycle/events.js",
  "app/lifecycle/shutdown.js",
  "app/health/httpServer.js",
  "app/health/metrics.js",
  "app/health/rateLimit.js"
];
const readBuiltFile = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const commandsSource = commandFiles.map(readBuiltFile).join("\n");
const runtimeSource = runtimeFiles.map(readBuiltFile).join("\n");
const allSource = `${commandsSource}\n${runtimeSource}`;

test("notification queues keep the duplicate-prevention guardrails", () => {
  assert.match(commandsSource, /async function claimSeenUpdate/);
  assert.match(commandsSource, /\[`seen\.\$\{gameKey\}`\]: \{ \$ne: updateId \}/);
  assert.match(commandsSource, /async function rollbackSeenUpdate/);
  assert.match(commandsSource, /await rollbackSeenUpdate\(String\(guild\._id\), gameKey, next\.id\)/);
  assert.match(commandsSource, /updatesInitializing: \{ \$ne: true \}/);
  assert.match(commandsSource, /discountsInitializing: \{ \$ne: true \}/);
});

test("start and stop handlers keep activation race protection", () => {
  assert.match(commandsSource, /const activationId = makeActivationId\(\)/);
  assert.match(commandsSource, /updatesActivationId: activationId/);
  assert.match(commandsSource, /discountsActivationId: activationId/);
  assert.match(commandsSource, /\$unset: \{ updatesActivationId: ""/);
  assert.match(commandsSource, /\$unset: \{ discountsActivationId: ""/);
});

test("V9 command surface is still present", () => {
  assert.match(commandsSource, /setName\("maxprice"\)/);
  assert.match(commandsSource, /setName\("stores"\)/);
  assert.match(commandsSource, /setName\("games"\)/);
  assert.match(commandsSource, /setName\("role"\)/);
  assert.match(commandsSource, /setAutocomplete\(true\)/);
});

test("automatic update notifications respect the per-game filter", () => {
  assert.match(commandsSource, /enabledGames/);
  assert.match(commandsSource, /hasGameFilter && !enabledSet\.has\(gameKey\)/);
});

test("manual latest updates respects the per-game filter", () => {
  assert.match(commandsSource, /Nu am date disponibile pentru jocurile active ale acestui server/);
  assert.match(commandsSource, /data\.filter\(\(?r\)? => r\.latest !== null && \(!enabledSet \|\| enabledSet\.has\(r\.game\.key\)\)\)/);
});

test("Discord permanent errors disable broken notification channels", () => {
  assert.match(commandsSource, /DISCORD_PERMANENT_ERROR_CODES/);
  assert.match(commandsSource, /10003/);
  assert.match(commandsSource, /10004/);
  assert.match(commandsSource, /50001/);
  assert.match(commandsSource, /50013/);
  assert.match(commandsSource, /function isPermanentDiscordError/);
  assert.match(commandsSource, /disableUpdatesForChannelError\(String\(guild\._id\), channel\.id, reason\)/);
  assert.match(commandsSource, /disableDiscountsForChannelError\(String\(guild\._id\), channel\.id, reason\)/);
});

test("Mongo retry wraps atomic notification claims", () => {
  assert.match(allSource, /function isTransientMongoError/);
  assert.match(allSource, /async function withMongoRetry/);
  assert.match(commandsSource, /withMongoRetry\(\(\) => GuildModel\.updateOne/);
  assert.match(commandsSource, /label: "claimSeenUpdate"/);
  assert.match(commandsSource, /label: "claimSeenDiscount"/);
});

test("deals currency cache is LRU bounded", () => {
  assert.match(commandsSource, /DEALS_CURRENCY_CACHE_MAX_SIZE/);
  assert.match(commandsSource, /evictLRU\(cache\.dealsByCurrency/);
  assert.match(commandsSource, /cache\.dealsByCurrency\.delete\(key\)/);
  assert.match(commandsSource, /cache\.dealsByCurrency\.set\(key, entry\)/);
});

test("cron health backoff is exposed", () => {
  assert.match(allSource, /GLOBAL_HEALTH_WINDOW/);
  assert.match(allSource, /GLOBAL_HEALTH_MIN_RATIO/);
  assert.match(allSource, /cronSkippedDueToHealth/);
  assert.match(runtimeSource, /function getHealthSnapshot/);
  assert.match(runtimeSource, /bot_cron_skipped_due_to_health/);
  assert.match(runtimeSource, /cronHealth = cronController\.getHealthSnapshot\(\)/);
});

test("health modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function createMetrics/);
  assert.match(runtimeSource, /function createRateLimiter/);
  assert.match(runtimeSource, /function createHttpServer/);
  assert.match(runtimeSource, /function firstHeaderValue/);
  assert.match(runtimeSource, /Array\.isArray\(value\)/);
});

test("boot lifecycle and Mongo lock modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function resolveConfigPath/);
  assert.match(runtimeSource, /function loadConfig/);
  assert.match(runtimeSource, /function registerDiscordEvents/);
  assert.match(runtimeSource, /function registerMongoEvents/);
  assert.match(runtimeSource, /function createShutdownController/);
  assert.match(runtimeSource, /function attachLocks/);
  assert.match(runtimeSource, /async function acquireDbLock/);
  assert.match(runtimeSource, /async function renewDbLock/);
  assert.match(runtimeSource, /async function releaseDbLock/);
});

test("shared logging and env modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function attachLogging/);
  assert.match(runtimeSource, /function logger/);
  assert.match(runtimeSource, /function parseEnvNumber/);
  assert.match(runtimeSource, /function getAbortSignal/);
  assert.match(runtimeSource, /function attachEnv/);
  assert.match(runtimeSource, /PLACEHOLDER_METRICS_TOKEN/);
  assert.match(runtimeSource, /LOG_SAMPLE_RATE/);
});

test("shared domain and utilities modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /class SchemaDriftError/);
  assert.match(runtimeSource, /SCHEMA_DRIFT/);
  assert.match(runtimeSource, /function getCurrencyConfig/);
  assert.match(runtimeSource, /function formatPrice/);
  assert.match(runtimeSource, /function attachUtilities/);
  assert.match(runtimeSource, /function validatePendingDiscountSnapshot/);
  assert.match(runtimeSource, /function isTransientMongoError/);
  assert.match(runtimeSource, /async function withMongoRetry/);
});

test("Mongo helper modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function attachGuildSettings/);
  assert.match(runtimeSource, /async function getGuildSettings/);
  assert.match(runtimeSource, /function invalidateGuildCache/);
  assert.match(runtimeSource, /function cleanGuildCache/);
  assert.match(runtimeSource, /function getGuildCacheSize/);
  assert.match(runtimeSource, /function attachAdminAlerts/);
  assert.match(runtimeSource, /async function adminAlert/);
  assert.match(runtimeSource, /ADMIN_ALERT/);
});

test("Mongo state and migration modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function attachSystemState/);
  assert.match(runtimeSource, /async function getSystemTimes/);
  assert.match(runtimeSource, /async function saveSystemTimes/);
  assert.match(runtimeSource, /function attachMigrations/);
  assert.match(runtimeSource, /async function runMigrations/);
  assert.match(runtimeSource, /ALL_MIGRATIONS/);
});

test("HTTP client module keeps TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function attachHttpClient/);
  assert.match(runtimeSource, /function attachMetrics/);
  assert.match(runtimeSource, /function cleanText/);
  assert.match(runtimeSource, /function normalizeUpdate/);
  assert.match(runtimeSource, /function safeCheerioLoad/);
  assert.match(runtimeSource, /function dealHash/);
  assert.match(runtimeSource, /async function httpReq/);
  assert.match(runtimeSource, /async function fetchWithProxy/);
  assert.match(runtimeSource, /function withInflightTimeout/);
  assert.match(runtimeSource, /function trackInflight/);
});

test("Steam source module keeps TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function attachSteam/);
  assert.match(runtimeSource, /async function searchSteamGameByName/);
  assert.match(runtimeSource, /function chooseBestSteamMatch/);
  assert.match(runtimeSource, /async function fetchSteamPriceDetails/);
  assert.match(runtimeSource, /function extractOfferEndFromHtml/);
  assert.match(runtimeSource, /async function extractSteamOfferEndDate/);
});

test("deal and update source modules keep TypeScript contracts after build", () => {
  assert.match(runtimeSource, /function attachDeals/);
  assert.match(runtimeSource, /async function fetchSteamReviewData/);
  assert.match(runtimeSource, /function enrichCacheGet/);
  assert.match(runtimeSource, /async function enrichDealData/);
  assert.match(runtimeSource, /async function fetchDeals/);
  assert.match(runtimeSource, /function attachUpdates/);
  assert.match(runtimeSource, /function absoluteUrl/);
  assert.match(runtimeSource, /function isLikelyPatchNote/);
  assert.match(runtimeSource, /async function fetchSteamUpdate/);
  assert.match(runtimeSource, /async function fetchListingBasedUpdate/);
  assert.match(runtimeSource, /async function executeFetchWithCircuitBreaker/);
  assert.match(runtimeSource, /async function getLatestForAllGames/);
});

test("driver RSS fallbacks reject missing and empty titles", () => {
  assert.match(runtimeSource, /AMD RSS fallback fara titlu in primul item/);
  assert.match(runtimeSource, /Intel RSS fallback fara titlu in primul item/);
  assert.match(runtimeSource, /Nvidia RSS fallback fara titlu in primul item/);
  assert.match(runtimeSource, /Nvidia RSS fallback cu titlu gol dupa curatare/);
});

test("cron lock acquisition errors are contained", () => {
  assert.match(runtimeSource, /lockAttemptStart/);
  assert.match(runtimeSource, /Nu am putut obtine lock-ul cron/);
  assert.match(runtimeSource, /cron:lock/);
  assert.match(runtimeSource, /recordHealth\(false/);
  assert.match(runtimeSource, /scheduleNextCron\(\)/);
});

test("cron abort signal reaches HTTP requests", () => {
  assert.match(runtimeSource, /abortSignal: currentCronAbortController\.signal/);
  assert.match(runtimeSource, /function getAbortSignal/);
  assert.match(runtimeSource, /const signal = options\.signal \|\|/);
  assert.match(runtimeSource, /reqConfig\.signal = signal/);
  assert.match(runtimeSource, /ERR_CANCELED|CanceledError|AbortError/);
});
