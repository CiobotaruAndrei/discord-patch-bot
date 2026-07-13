
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

import test from "node:test";
import assert from "node:assert/strict";
const _____features_command_registry_commandRegistry = (await import("../../features/command-registry/commandRegistry.js")).default;
import type { FindGameResult } from "../../features/command-presentation/gameLookupCache.js";
import type { GameConfig } from "../../config/configTypes.js";
const { findGameAndSuggestion, clearFindGameCache } = _____features_command_registry_commandRegistry;
const findGame = (input: string, gs: GameConfig[]): FindGameResult => findGameAndSuggestion(input, gs) as FindGameResult;

const games: GameConfig[] = [
  { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730", aliases: ["counter strike", "cs"] },
  { key: "minecraft", name: "Minecraft", type: "minecraft", aliases: ["mc"] },
  { key: "fortnite", name: "Fortnite", type: "epic_games" },
  { key: "rocket-league", name: "Rocket League", type: "epic_games", aliases: ["rl"] },
  { key: "nvidiagr", name: "NVIDIA Game Ready Drivers", type: "nvidia", upCRD: 1 }
];

test("gaseste match exact al key-ului", () => {
  clearFindGameCache();
  const result = findGame("cs2", games);
  assert.equal(result.game?.key, "cs2");
  assert.equal(result.suggestion, null);
});

test("gaseste match exact al numelui", () => {
  clearFindGameCache();
  const result = findGame("Minecraft", games);
  assert.equal(result.game?.key, "minecraft");
  assert.equal(result.suggestion, null);
});

test("gaseste match exact al aliasului", () => {
  clearFindGameCache();
  const result = findGame("cs", games);
  assert.equal(result.game?.key, "cs2");
  assert.equal(result.suggestion, null);
});

test("accepta alias cu spatiu", () => {
  clearFindGameCache();
  const result = findGame("counter strike", games);
  assert.equal(result.game?.key, "cs2");
});

test("normalizeaza linii si underscore in input", () => {
  clearFindGameCache();
  const result = findGame("rocket_league", games);
  assert.equal(result.game?.key, "rocket-league");
});

test("ofera sugestie cand typo este aproape", () => {
  clearFindGameCache();
  const result = findGame("minecaft", games);
  assert.ok(result.game?.key === "minecraft" || result.suggestion?.key === "minecraft");
});

test("returneaza doar suggestion pentru typo cu distanta mai mare", () => {
  clearFindGameCache();
  const result = findGame("minikraft", games);
  assert.equal(result.game, null);
  assert.equal(result.suggestion?.key, "minecraft");
});

test("returneaza null pentru input total diferit", () => {
  clearFindGameCache();
  const result = findGame("xyzabc123nonexistent", games);
  assert.equal(result.game, null);
  assert.equal(result.suggestion, null);
});

test("input gol returneaza null", () => {
  clearFindGameCache();
  const result = findGame("", games);
  assert.equal(result.game, null);
});

test("cache reuse pastreaza acelasi rezultat", () => {
  clearFindGameCache();
  const r1 = findGame("cs", games);
  const r2 = findGame("cs", games);
  assert.deepEqual(
    { game: r1.game?.key, suggestion: r1.suggestion?.key },
    { game: r2.game?.key, suggestion: r2.suggestion?.key }
  );
});

test("cache se invalideaza cand games array se schimba", () => {
  clearFindGameCache();
  findGame("cs", games);
  const newGames: GameConfig[] = [{ key: "newkey", name: "New Game", type: "minecraft", aliases: ["cs"] }];
  const result = findGame("cs", newGames);
  assert.equal(result.game?.key, "newkey");
});

export {};
