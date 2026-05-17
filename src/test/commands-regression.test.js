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
  "features/notifications/index.js",
  "features/commands/slashCommands.js",
  "features/commands/interactions.js"
];
const runtimeFiles = [
  "shared/env.js",
  "shared/utilities.js",
  "shared/logging.js",
  "infra/http/client.js",
  "app/scheduler/cron.js",
  "app/health/httpServer.js",
  "app/health/metrics.js"
];
const readBuiltFile = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
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
  assert.match(commandsSource, /data\.filter\(r => r\.latest !== null && \(!enabledSet \|\| enabledSet\.has\(r\.game\.key\)\)\)/);
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

test("cron abort signal reaches HTTP requests", () => {
  assert.match(runtimeSource, /abortSignal: currentCronAbortController\.signal/);
  assert.match(runtimeSource, /function getAbortSignal/);
  assert.match(runtimeSource, /const signal = options\.signal \|\|/);
  assert.match(runtimeSource, /reqConfig\.signal = signal/);
  assert.match(runtimeSource, /ERR_CANCELED|CanceledError|AbortError/);
});
