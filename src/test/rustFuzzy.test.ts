// @ts-check
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findGameKeys, isRustFuzzyAvailable, levenshtein } = require("../native/fuzzy");

const games = [
  { key: "cs2", name: "Counter-Strike 2", aliases: ["counter strike", "cs"] },
  { key: "minecraft", name: "Minecraft", aliases: ["mc"] },
  { key: "rocket-league", name: "Rocket League", aliases: ["rl"] }
];

test("Rust fuzzy addon is loaded for project checks", () => {
  assert.equal(isRustFuzzyAvailable(), true);
});

test("Rust levenshtein keeps expected edit distances", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("minecraft", "minecaft"), 1);
  assert.equal(levenshtein("", "cs2"), 3);
});

test("Rust fuzzy matching returns exact game keys", () => {
  const result = findGameKeys("rocket_league", games, 80);
  assert.equal(result.gameKey, "rocket-league");
  assert.equal(result.suggestionKey, null);
});

test("Rust fuzzy matching returns suggestion keys for wider typo", () => {
  const result = findGameKeys("minikraft", games, 80);
  assert.equal(result.gameKey, null);
  assert.equal(result.suggestionKey, "minecraft");
});

export {};
