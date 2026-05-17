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
const commandsSource = commandFiles
  .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n");

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
