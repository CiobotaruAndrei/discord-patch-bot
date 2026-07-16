import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const runtimeFiles = [
  "config/configLoader.js",
  "shared/domain.js",
  "shared/env.js",
  "shared/utilities.js",
  "shared/logging.js",
  "infra/http/client.js",
  "infra/http/contentNormalization.js",
  "infra/http/inflightTracker.js",
  "infra/http/proxyClient.js",
  "infra/mongo/guildSettings.js",
  "infra/mongo/adminAlerts.js",
  "infra/mongo/locks.js",
  "infra/mongo/migrations.js",
  "infra/mongo/systemState.js",
  "sources/steam/index.js",
  "sources/deals/index.js",
  "sources/deals/dealHelpers.js",
  "sources/deals/steamDeals.js",
  "sources/deals/epicDeals.js",
  "sources/deals/dealEnrichment.js",
  "sources/updates/index.js",
  "sources/updates/updatesSourceDispatch.js",
  "sources/updates/updatesCircuitBreaker.js",
  "sources/updates/updatesFetchOrchestrator.js",
  "sources/updates/updateHelpers.js",
  "sources/updates/steamUpdates.js",
  "sources/updates/listingUpdates.js",
  "sources/updates/driverUpdates.js",
  "sources/updates/platformUpdates.js",
  "app/scheduler/cron.js",
  "app/scheduler/cronHealthWindow.js",
  "app/scheduler/cronScheduleConfig.js",
  "app/scheduler/cronJobRunner.js",
  "app/lifecycle/events.js",
  "app/lifecycle/shutdown.js",
  "app/health/httpServer.js",
  "app/health/metricsRegistry.js",
  "app/health/metrics.js",
  "app/health/rateLimit.js"
];

const readBuiltFile = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");
const readBuiltFilesUnder = (...segments: string[]) => {
  const root = path.join(__dirname, "..", "..", ...segments);
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

const defines = (name: string): RegExp => new RegExp(`(?:function\\s+${name}\\b|\\b${name}\\s*[=:])`);

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

test("defines() detecteaza un simbol indiferent de forma declaratiei (function decl / const arrow / metoda), fara fals pozitiv pe prefix", () => {
  for (const form of ["function foo(", "async function foo()", "const foo = async () =>", "let foo = () =>", "foo: async () =>", "export function foo("]) {
    assert.match(form, defines("foo"), `defines detecteaza forma: ${form}`);
  }
  assert.doesNotMatch("barfoo = 1", defines("foo"), "fara fals pozitiv cand numele e sufixul altui identificator");
  assert.doesNotMatch("foo()", defines("foo"), "o simpla apelare (fara =/:/function) nu conteaza ca definitie");
});

test("notification queues keep the duplicate-prevention guardrails", () => {
  expectAll(commandsSource, [
    defines("claimSeenUpdate"),
    /GuildSeenUpdateModel/,
    /upsertedCount/,
    /updateId/,
    defines("rollbackSeenUpdate"),
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
    defines("isPermanentDiscordError"),
    /disableUpdatesForChannelError/,
    /disableDiscountsForChannelError/
  ]);
});

test("Mongo retry wraps atomic notification claims", () => {
  expectAll(allSource, [
    defines("isTransientMongoError"),
    defines("withMongoRetry")
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
    defines("getHealthSnapshot"),
    /bot_cron_skipped_due_to_health/,
    /cronHealth/,
    /getHealthSnapshot/
  ]);
});

test("health modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("createMetrics"),
    defines("createRateLimiter"),
    defines("createHttpServer"),
    defines("firstHeaderValue"),
    /Array\.isArray\(value\)/
  ]);
});

test("boot lifecycle and Mongo lock modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("resolveConfigPath"),
    defines("loadConfig"),
    defines("registerDiscordEvents"),
    /startOutboxWorker/,
    defines("registerMongoEvents"),
    defines("createShutdownController"),
    defines("attachLocks"),
    defines("acquireDbLock"),
    defines("renewDbLock"),
    defines("releaseDbLock")
  ]);
});

test("shared logging and env modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("attachLogging"),
    defines("logger"),
    defines("parseEnvNumber"),
    defines("getAbortSignal"),
    defines("attachEnv"),
    /PLACEHOLDER_METRICS_TOKEN/,
    /LOG_SAMPLE_RATE/
  ]);
});

test("shared domain and utilities modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    /class SchemaDriftError/,
    /SCHEMA_DRIFT/,
    defines("getCurrencyConfig"),
    defines("formatPrice"),
    defines("attachUtilities"),
    defines("validatePendingDiscountSnapshot"),
    defines("isTransientMongoError"),
    defines("withMongoRetry")
  ]);
});

test("Mongo helper modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("attachGuildSettings"),
    defines("getGuildSettings"),
    defines("invalidateGuildCache"),
    defines("cleanGuildCache"),
    defines("getGuildCacheSize"),
    defines("attachAdminAlerts"),
    defines("adminAlert"),
    /ADMIN_ALERT/
  ]);
});

test("Mongo state and migration modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("attachSystemState"),
    defines("buildSystemStateFrom"),
    /getSystemTimes = async/,
    /saveSystemTimes = async/,
    defines("attachMigrations"),
    defines("runMigrations"),
    /ALL_MIGRATIONS/
  ]);
});

test("HTTP client module keeps TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("buildHttpClientFrom"),
    defines("attachMetrics"),
    defines("cleanText"),
    defines("normalizeUpdate"),
    defines("safeCheerioLoad"),
    defines("dealHash"),
    defines("httpReq"),
    defines("fetchWithProxy"),
    defines("withInflightTimeout"),
    defines("trackInflight")
  ]);
});

test("Steam source module keeps TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("searchSteamGameByName"),
    defines("chooseBestSteamMatch"),
    defines("fetchSteamPriceDetails"),
    defines("extractOfferEndFromHtml"),
    defines("extractSteamOfferEndDate")
  ]);
});

test("deal and update source modules keep TypeScript contracts after build", () => {
  expectAll(runtimeSource, [
    defines("fetchSteamReviewData"),
    defines("enrichCacheGet"),
    defines("enrichDealData"),
    defines("fetchDeals"),
    defines("absoluteUrl"),
    defines("isLikelyPatchNote"),
    defines("fetchSteamUpdate"),
    defines("fetchListingBasedUpdate"),
    defines("executeFetchWithCircuitBreaker"),
    defines("getLatestForAllGames")
  ]);
});

test("driver RSS parsing rejects missing and empty titles (RSS e sursa primara pentru drivere)", () => {
  expectAll(runtimeSource, [
    /RSS fara titlu in primul item/,
    /RSS cu titlu gol dupa curatare/,
    /parseDriverRssFeed/,
    /AMD RSS \(sursa primara\) a esuat/,
    /Intel RSS \(sursa primara\) a esuat/
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
    defines("getAbortSignal"),
    /reqConfig\.signal/,
    /ERR_CANCELED|CanceledError|AbortError/
  ]);
});
