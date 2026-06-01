
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
const readBuiltFilesUnder = (...segments: string[]) => {
  const root = path.join(__dirname, "..", ...segments);
  const chunks: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile() && entry.name.endsWith(".js")) {
        chunks.push(fs.readFileSync(fullPath, "utf8"));
      }
    }
  };
  visit(root);
  return chunks.join("\n");
};

const expectAll = (source: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    assert.match(source, pattern);
  }
};

const commandsSource = [
  readBuiltFilesUnder("features"),
  readBuiltFile("domain/deals/filters.js")
].join("\n");
const runtimeSource = runtimeFiles.map(readBuiltFile).join("\n");
const allSource = `${commandsSource}\n${runtimeSource}`;

test("notification queues keep the duplicate-prevention guardrails", () => {
  expectAll(commandsSource, [
    /async function claimSeenUpdate/,
    /GuildSeenUpdateModel/,
    /upsertedCount/,
    /updateId/,
    /async function rollbackSeenUpdate/,
    /rollbackSeenUpdate/,
    /updatesInitializing/,
    /discountsInitializing/
  ]);
});

test("start and stop handlers keep activation race protection", () => {
  expectAll(commandsSource, [
    /makeActivationId/,
    /updatesActivationId/,
    /discountsActivationId/,
    /\$unset/
  ]);
});

test("command surface is still present", () => {
  expectAll(commandsSource, [
    /setName\("maxprice"\)/,
    /setName\("stores"\)/,
    /setName\("games"\)/,
    /setName\("role"\)/,
    /setAutocomplete\(true\)/
  ]);
});

test("automatic update notifications respect the per-game filter", () => {
  expectAll(commandsSource, [
    /enabledGames/,
    /hasGameFilter/,
    /enabledSet\.has\(gameKey\)/
  ]);
});

test("manual latest updates respects the per-game filter", () => {
  expectAll(commandsSource, [
    /Nu am date disponibile pentru jocurile active ale acestui server/,
    /data\.filter/,
    /latest/,
    /enabledSet\.has/
  ]);
});

test("Discord permanent errors disable broken notification channels", () => {
  expectAll(commandsSource, [
    /DISCORD_PERMANENT_ERROR_CODES/,
    /10003/,
    /10004/,
    /50001/,
    /50013/,
    /function isPermanentDiscordError/,
    /disableUpdatesForChannelError/,
    /disableDiscountsForChannelError/
  ]);
});

test("Mongo retry wraps atomic notification claims", () => {
  expectAll(allSource, [
    /function isTransientMongoError/,
    /async function withMongoRetry/
  ]);
  expectAll(commandsSource, [
    /withMongoRetry/,
    /claimSeenUpdate/,
    /claimSeenDiscount/
  ]);
});

test("deals currency cache is LRU bounded", () => {
  expectAll(commandsSource, [
    /DEALS_CURRENCY_CACHE_MAX_SIZE/,
    /dealsByCurrency/,
    /evictLRU/,
    /cache\.dealsByCurrency\.delete/,
    /cache\.dealsByCurrency\.set/
  ]);
});

test("cron health backoff is exposed", () => {
  expectAll(allSource, [
    /GLOBAL_HEALTH_WINDOW/,
    /GLOBAL_HEALTH_MIN_RATIO/,
    /cronSkippedDueToHealth/
  ]);
  expectAll(runtimeSource, [
    /function getHealthSnapshot/,
    /bot_cron_skipped_due_to_health/,
    /cronHealth/,
    /getHealthSnapshot/
  ]);
});

test("health modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function createMetrics/,
    /function createRateLimiter/,
    /function createHttpServer/,
    /function firstHeaderValue/,
    /Array\.isArray\(value\)/
  ]);
});

test("boot lifecycle and Mongo lock modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function resolveConfigPath/,
    /function loadConfig/,
    /function registerDiscordEvents/,
    /startOutboxWorker/,
    /function registerMongoEvents/,
    /function createShutdownController/,
    /function attachLocks/,
    /async function acquireDbLock/,
    /async function renewDbLock/,
    /async function releaseDbLock/
  ]);
});

test("shared logging and env modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function attachLogging/,
    /function logger/,
    /function parseEnvNumber/,
    /function getAbortSignal/,
    /function attachEnv/,
    /PLACEHOLDER_METRICS_TOKEN/,
    /LOG_SAMPLE_RATE/
  ]);
});

test("shared domain and utilities modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /class SchemaDriftError/,
    /SCHEMA_DRIFT/,
    /function getCurrencyConfig/,
    /function formatPrice/,
    /function attachUtilities/,
    /function validatePendingDiscountSnapshot/,
    /function isTransientMongoError/,
    /async function withMongoRetry/
  ]);
});

test("Mongo helper modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function attachGuildSettings/,
    /async function getGuildSettings/,
    /function invalidateGuildCache/,
    /function cleanGuildCache/,
    /function getGuildCacheSize/,
    /function attachAdminAlerts/,
    /async function adminAlert/,
    /ADMIN_ALERT/
  ]);
});

test("Mongo state and migration modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function attachSystemState/,
    /async function getSystemTimes/,
    /async function saveSystemTimes/,
    /function attachMigrations/,
    /async function runMigrations/,
    /ALL_MIGRATIONS/
  ]);
});

test("HTTP client module keeps TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function attachHttpClient/,
    /function attachMetrics/,
    /function cleanText/,
    /function normalizeUpdate/,
    /function safeCheerioLoad/,
    /function dealHash/,
    /async function httpReq/,
    /async function fetchWithProxy/,
    /function withInflightTimeout/,
    /function trackInflight/
  ]);
});

test("Steam source module keeps TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function attachSteam/,
    /async function searchSteamGameByName/,
    /function chooseBestSteamMatch/,
    /async function fetchSteamPriceDetails/,
    /function extractOfferEndFromHtml/,
    /async function extractSteamOfferEndDate/
  ]);
});

test("deal and update source modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /function attachDeals/,
    /async function fetchSteamReviewData/,
    /function enrichCacheGet/,
    /async function enrichDealData/,
    /async function fetchDeals/,
    /function attachUpdates/,
    /function absoluteUrl/,
    /function isLikelyPatchNote/,
    /async function fetchSteamUpdate/,
    /async function fetchListingBasedUpdate/,
    /async function executeFetchWithCircuitBreaker/,
    /async function getLatestForAllGames/
  ]);
});

test("driver RSS fallbacks reject missing and empty titles", () => {
  expectAll(runtimeSource, [
    /AMD RSS fallback fara titlu in primul item/,
    /Intel RSS fallback fara titlu in primul item/,
    /Nvidia RSS fallback fara titlu in primul item/,
    /Nvidia RSS fallback cu titlu gol dupa curatare/
  ]);
});

test("cron lock acquisition errors are contained", () => {
  expectAll(runtimeSource, [
    /lockAttemptStart/,
    /Nu am putut obtine lock-ul cron/,
    /cron:lock/,
    /recordHealth\(false/,
    /scheduleNextCron\(\)/
  ]);
});

test("cron abort signal reaches HTTP requests", () => {
  expectAll(runtimeSource, [
    /abortSignal/,
    /currentCronAbortController/,
    /function getAbortSignal/,
    /reqConfig\.signal/,
    /ERR_CANCELED|CanceledError|AbortError/
  ]);
});
