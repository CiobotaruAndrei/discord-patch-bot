// @ts-check
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPatchNote,
  cleanText,
  dealHash,
  findGameKeys,
  isRustFuzzyAvailable,
  levenshtein,
  normalizeDealState,
  normalizeTitleForDedupe,
  stableUpdateId
} = require("../native/fuzzy");

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

test("Rust title normalization matches deal dedupe behavior", () => {
  assert.equal(normalizeTitleForDedupe("Counter-Strike\u00ae 2\u2122!!!"), "counter strike 2");
});

test("Rust classifyPatchNote: bad-in-title rejects despite good words", () => {
  // "trailer" alone (badInTitle) wins even if body says "update"
  assert.equal(classifyPatchNote("Season 5 Trailer", "comes with an update", []), false);
  assert.equal(classifyPatchNote("Community giveaway", "huge patch incoming", []), false);
});

test("Rust classifyPatchNote: explicit patch tags win over body", () => {
  assert.equal(classifyPatchNote("Some Title", "no relevant words", ["PatchNotes"]), true);
  assert.equal(classifyPatchNote("Some Title", "", ["update"]), true);
});

test("Rust classifyPatchNote: matches on good words in title or contents", () => {
  assert.equal(classifyPatchNote("Hotfix 1.2.3", "", []), true);
  assert.equal(classifyPatchNote("Weekly digest", "small bug fixes inside", []), true);
});

test("Rust classifyPatchNote: rejects unrelated news", () => {
  assert.equal(classifyPatchNote("New plushie store", "merch available now", []), false);
  assert.equal(classifyPatchNote("Devblog: art direction", "concept sketches", []), false);
});

test("Rust classifyPatchNote: handles missing/odd inputs without throwing", () => {
  assert.equal(classifyPatchNote("", "", []), false);
  assert.equal(classifyPatchNote(undefined, undefined, undefined), false);
});

test("Rust cleanText strips tags and decodes entities", () => {
  // Same fixtures the JS implementation handled. Output must match JS byte-for-byte
  // so existing scrapers don't drift.
  assert.equal(cleanText("<p>Hello   <b>world</b>!</p>"), "Hello world !");
  assert.equal(cleanText("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(cleanText("It&#39;s &quot;hot&quot;"), "It's \"hot\"");
  assert.equal(cleanText("&NBSP;case-insensitive&AMP;"), "case-insensitive&");
  assert.equal(cleanText("unknown &foo; entity"), "unknown &foo; entity");
  assert.equal(cleanText("  leading\nand\ttrailing  "), "leading and trailing");
  assert.equal(cleanText(""), "");
  // Multibyte UTF-8 stays valid through the byte scanner.
  assert.equal(cleanText("<span>caf\u00e9 \u2014 \u4e2d\u6587</span>"), "caf\u00e9 \u2014 \u4e2d\u6587");
});

test("Rust stable update ids match SHA1 contract", () => {
  assert.equal(stableUpdateId("Patch", "https://example.com/update"), "7f512d1c3e0464b1");
});

test("stable update id is exactly 16 lowercase hex chars regardless of input", () => {
  const samples = [
    ["", ""],
    ["a", "b"],
    ["Some very long title with special chars: éà / 中文 🎮", "https://store.steampowered.com/app/999999?cc=US&l=english"]
  ];
  for (const [title, link] of samples) {
    const id = stableUpdateId(title, link);
    assert.equal(id.length, 16, `expected 16 chars, got ${id.length} for ${JSON.stringify([title, link])}`);
    assert.match(id, /^[0-9a-f]{16}$/, `expected lowercase hex, got ${id}`);
  }
});

test("Rust deal state normalization trims and lowercases values", () => {
  assert.equal(normalizeDealState({ salePrice: " 9.99 ", normalPrice: "19.99", savings: 50 }), "9.99:19.99:50");
});

test("Rust deal hashes preserve stable Steam, Epic and listing keys", () => {
  assert.equal(dealHash({
    store: "Steam",
    steamAppID: 730,
    title: "Counter-Strike 2",
    salePrice: "9.99",
    normalPrice: "19.99",
    savings: "50"
  }), "5c0280542102f361747d03b0c15241b65de1b8c6");

  assert.equal(dealHash({
    store: "Epic Games",
    id: "epic_abc-123",
    title: "Some Epic Game",
    salePrice: "5.00",
    normalPrice: "10.00",
    savings: "50"
  }), "624513cc2f304303abd6638f9b6286de4b61eeb1");

  assert.equal(dealHash({
    store: "Itch.io",
    title: "Some Listing Game!!!",
    salePrice: "7.50",
    normalPrice: "15.00",
    savings: "50"
  }), "851f5fc3c20f8379c5d78cff6300dd601c835d02");
});

export {};
