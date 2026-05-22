// @ts-check
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findGameAndSuggestion, clearFindGameCache } = require("../features/command-registry/commandRegistry");

const games = [
  { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730", aliases: ["counter strike", "cs"] },
  { key: "minecraft", name: "Minecraft", type: "minecraft", aliases: ["mc"] },
  { key: "fortnite", name: "Fortnite", type: "epic_games" },
  { key: "rocket-league", name: "Rocket League", type: "epic_games", aliases: ["rl"] },
  { key: "nvidiagr", name: "NVIDIA Game Ready Drivers", type: "nvidia", upCRD: 1 }
];

test("gaseste match exact al key-ului", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("cs2", games);
  assert.equal(result.game?.key, "cs2");
  assert.equal(result.suggestion, null);
});

test("gaseste match exact al numelui", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("Minecraft", games);
  assert.equal(result.game?.key, "minecraft");
  assert.equal(result.suggestion, null);
});

test("gaseste match exact al aliasului", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("cs", games);
  assert.equal(result.game?.key, "cs2");
  assert.equal(result.suggestion, null);
});

test("accepta alias cu spatiu", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("counter strike", games);
  assert.equal(result.game?.key, "cs2");
});

test("normalizeaza linii si underscore in input", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("rocket_league", games);
  assert.equal(result.game?.key, "rocket-league");
});

test("ofera sugestie cand typo este aproape", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("minecaft", games);
  assert.ok(result.game?.key === "minecraft" || result.suggestion?.key === "minecraft");
});

test("returneaza doar suggestion pentru typo cu distanta mai mare", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("minikraft", games);
  assert.equal(result.game, null);
  assert.equal(result.suggestion?.key, "minecraft");
});

test("returneaza null pentru input total diferit", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("xyzabc123nonexistent", games);
  assert.equal(result.game, null);
  assert.equal(result.suggestion, null);
});

test("input gol returneaza null", () => {
  clearFindGameCache();
  const result = findGameAndSuggestion("", games);
  assert.equal(result.game, null);
});

test("cache reuse pastreaza acelasi rezultat", () => {
  clearFindGameCache();
  const r1 = findGameAndSuggestion("cs", games);
  const r2 = findGameAndSuggestion("cs", games);
  assert.deepEqual(
    { game: r1.game?.key, suggestion: r1.suggestion?.key },
    { game: r2.game?.key, suggestion: r2.suggestion?.key }
  );
});

test("cache se invalideaza cand games array se schimba", () => {
  clearFindGameCache();
  findGameAndSuggestion("cs", games);
  const newGames = [{ key: "newkey", name: "New Game", type: "minecraft", aliases: ["cs"] }];
  const result = findGameAndSuggestion("cs", newGames);
  assert.equal(result.game?.key, "newkey");
});

export {};
