import test from "node:test";
import assert from "node:assert/strict";

const {
  isRustFuzzyAvailable,
  ensureNativeFuzzy,
  dealHash,
  dealHashFallback,
  stableUpdateId,
  stableUpdateIdFallback,
  findGameKeys,
  findGameKeysFallback
} = require("../native/fuzzy");

const games = [
  { key: "cs2", name: "Counter-Strike 2", aliases: ["counter strike", "cs"] },
  { key: "minecraft", name: "Minecraft", aliases: ["mc"] },
  { key: "rocket-league", name: "Rocket League", aliases: ["rl"] }
];

const deals = [
  { store: "Steam", steamAppID: 730, id: "steam_730", title: "Counter-Strike 2", salePrice: "9.99", normalPrice: "19.99", savings: "50" },
  { store: "Epic Games", id: "epic_abc-123", title: "Some Epic Game", salePrice: "5.00", normalPrice: "10.00", savings: "50" },
  { store: "Itch.io", title: "Some Listing Game®!!!", salePrice: "7.50", normalPrice: "15.00", savings: "50" },
  { store: "Steam", steamAppID: 0, id: "", title: "Free Game", salePrice: "0", normalPrice: "0", savings: 0 },
  { store: "Epic Games", id: "epic_", title: "Edge Case", salePrice: "", normalPrice: "", savings: undefined }
];

const updateIds: Array<[unknown, unknown]> = [
  ["Patch", "https://example.com/update"],
  ["", ""],
  ["Some very long title with: éà / 中文 🎮", "https://store.steampowered.com/app/999999?cc=US&l=english"],
  ["Hotfix 1.2.3", "https://x/news/2024-05-20"]
];

const fuzzyInputs = ["cs2", "rocket_league", "minikraft", "counter strike", "", "x", "minecraftt", "🎮cs2", "rocket league"];

test("native parity: dealHash Rust output matches the TypeScript fallback", (t) => {
  if (!isRustFuzzyAvailable()) { t.skip("addon Rust indisponibil - nimic de comparat"); return; }
  for (const deal of deals) {
    assert.equal(dealHash(deal), dealHashFallback(deal), `dealHash diverge pentru ${JSON.stringify(deal)}`);
  }
});

test("native parity: stableUpdateId Rust output matches the TypeScript fallback", (t) => {
  if (!isRustFuzzyAvailable()) { t.skip("addon Rust indisponibil - nimic de comparat"); return; }
  for (const [title, link] of updateIds) {
    assert.equal(stableUpdateId(title, link), stableUpdateIdFallback(title, link), `stableUpdateId diverge pentru ${JSON.stringify([title, link])}`);
  }
});

test("native parity: findGameKeys Rust output matches the TypeScript fallback", (t) => {
  if (!isRustFuzzyAvailable()) { t.skip("addon Rust indisponibil - nimic de comparat"); return; }
  for (const input of fuzzyInputs) {
    assert.deepEqual(
      findGameKeys(input, games, 100),
      findGameKeysFallback(input, games, 100),
      `findGameKeys diverge pentru ${JSON.stringify(input)}`
    );
  }
});

test("ensureNativeFuzzy does not throw when the addon is available, even if required", () => {
  if (!isRustFuzzyAvailable()) return;
  const previous = process.env.REQUIRE_NATIVE_FUZZY;
  process.env.REQUIRE_NATIVE_FUZZY = "true";
  try {
    assert.doesNotThrow(() => ensureNativeFuzzy());
  } finally {
    if (previous === undefined) delete process.env.REQUIRE_NATIVE_FUZZY;
    else process.env.REQUIRE_NATIVE_FUZZY = previous;
  }
});

export {};
