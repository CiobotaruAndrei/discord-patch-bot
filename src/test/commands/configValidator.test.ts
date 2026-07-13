"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../../config/configValidator.js";

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

test("rejects unknown fields in a game (typo) instead of passing them through silently", () => {
  assert.throws(
    () => validateConfig(baseConfig({
      games: [{ key: "cs2", name: "Counter-Strike 2", type: "steam", appid: "730" }]
    }), "unit-test"),
    /Unrecognized key|appid/i,
    "un camp gresit scris (appid in loc de appId) trebuie respins, nu acceptat tacut"
  );
});

test("accepts a game with only known fields (strict nu respinge config valid)", () => {
  const validated = validateConfig(baseConfig({
    games: [{ key: "gta", name: "Grand Theft Auto V", type: "listing_based", baseUrl: "https://example.com", listingUrl: "https://example.com/news" }]
  }), "unit-test");
  assert.equal(validated.games.length, 1);
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

test("epic_games non-fortnite requires baseUrl and listing URL(s)", () => {
  assert.doesNotThrow(
    () => validateConfig(baseConfig({
      games: [{ key: "fortnite", name: "Fortnite", type: "epic_games" }]
    }), "unit-test"),
    "fortnite is allowed without listingUrl (uses its own implementation)"
  );

  assert.throws(
    () => validateConfig(baseConfig({
      games: [{ key: "egstore", name: "Epic Games Store", type: "epic_games" }]
    }), "unit-test"),
    /epic_games \(non-fortnite\)/,
    "non-fortnite epic_games without baseUrl/listingUrl must fail validation"
  );

  assert.throws(
    () => validateConfig(baseConfig({
      games: [{
        key: "egstore",
        name: "Epic Games Store",
        type: "epic_games",
        listingUrl: "https://store.epicgames.com/feed"

      }]
    }), "unit-test"),
    /baseUrl/,
    "non-fortnite epic_games still requires baseUrl when listingUrl is given"
  );

  assert.doesNotThrow(
    () => validateConfig(baseConfig({
      games: [{
        key: "egstore",
        name: "Epic Games Store",
        type: "epic_games",
        baseUrl: "https://store.epicgames.com",
        listingUrls: ["https://store.epicgames.com/feed/news"]
      }]
    }), "unit-test"),
    "non-fortnite epic_games with baseUrl + listingUrls is valid"
  );
});

test("rejects duplicate listingUrls for listing_based and epic_games (non-fortnite)", () => {
  assert.throws(
    () => validateConfig(baseConfig({
      games: [{
        key: "lb",
        name: "Listing Source",
        type: "listing_based",
        baseUrl: "https://example.com",
        listingUrls: ["https://example.com/feed", "https://example.com/feed"]
      }]
    }), "unit-test"),
    /listingUrls nu trebuie sa contina URL-uri duplicate/
  );

  assert.throws(
    () => validateConfig(baseConfig({
      games: [{
        key: "egstore",
        name: "Epic Games Store",
        type: "epic_games",
        baseUrl: "https://store.epicgames.com",
        listingUrls: ["https://store.epicgames.com/feed", "https://store.epicgames.com/feed"]
      }]
    }), "unit-test"),
    /listingUrls nu trebuie sa contina URL-uri duplicate/,
    "epic_games duplicates must now be rejected too, symmetric with listing_based"
  );
});
