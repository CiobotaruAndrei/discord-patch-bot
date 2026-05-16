"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig } = require("../configValidator");

function baseConfig(overrides = {}) {
  return {
    checkIntervalMinutes: 30,
    games: [
      { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730", aliases: ["counter strike"] },
      { key: "minecraft", name: "Minecraft", type: "minecraft" }
    ],
    ...overrides
  };
}

test("accepts the current supported config shape", () => {
  const validated = validateConfig(baseConfig(), "unit-test");
  assert.equal(validated.games.length, 2);
});

test("rejects unsupported cron intervals", () => {
  assert.throws(
    () => validateConfig(baseConfig({ checkIntervalMinutes: 17 }), "unit-test"),
    /10, 15, 30 sau 60/
  );
});

test("rejects duplicate keys and aliases", () => {
  assert.throws(
    () => validateConfig(baseConfig({
      games: [
        { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730", aliases: ["cs"] },
        { key: "csgo", name: "Other", type: "steam", appId: "999", aliases: ["cs"] }
      ]
    }), "unit-test"),
    /duplicat/
  );
});

test("rejects non numeric Steam app IDs", () => {
  assert.throws(
    () => validateConfig(baseConfig({
      games: [{ key: "bad", name: "Bad Steam", type: "steam", appId: "abc" }]
    }), "unit-test"),
    /doar cifre/
  );
});

test("keeps legacy upCRD limited to NVIDIA entries", () => {
  assert.doesNotThrow(() => validateConfig(baseConfig({
    games: [{ key: "nvidiagr", name: "NVIDIA Game Ready Drivers", type: "nvidia", upCRD: 0 }]
  }), "unit-test"));

  assert.throws(
    () => validateConfig(baseConfig({
      games: [{ key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730", upCRD: 1 }]
    }), "unit-test"),
    /legacy/
  );
});
