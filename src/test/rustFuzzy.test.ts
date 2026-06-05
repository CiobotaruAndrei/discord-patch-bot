
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAutocompleteChoices,
  classifyPatchNote,
  cleanText,
  dealPassesFilters,
  dealHash,
  extractDateScore,
  findGameKeys,
  isGoodSteamArticleUrl,
  isRustFuzzyAvailable,
  levenshtein,
  normalizeDealState,
  normalizeTitleForDedupe,
  rankListingCandidates,
  rankListingCandidatesFallback,
  scoreListingCandidate,
  stableUpdateId
} = require("../native/fuzzy");

const LISTING_SAMPLE = [
  { href: "https://x.com/news/2024-01-05/intro", text: "Intro article", position: 0 },
  { href: "https://x.com/news/2024-03-12/big-patch-notes", text: "Big patch update", position: 1 },
  { href: "https://x.com/blog/no-date-here/teaser", text: "Teaser hotfix", position: 2 },
  { href: "https://x.com/news/2024-03-12/older-patch", text: "Another patch", position: 3 },
  { href: "https://x.com/news/2023-11-20/legacy-update", text: "Legacy update", position: 4 }
];

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

test("rankListingCandidates: native si fallback dau aceeasi ordine (paritate)", () => {
  const keywords = ["patch", "update"];
  const nativeOrder = rankListingCandidates(LISTING_SAMPLE, keywords).map((c: { position: number }) => c.position);
  const fallbackOrder = rankListingCandidatesFallback(LISTING_SAMPLE, keywords).map((c: { position: number }) => c.position);
  assert.deepEqual(nativeOrder, fallbackOrder);
});

test("rankListingCandidates: scor keyword desc, apoi data desc, apoi pozitie asc", () => {
  const ranked = rankListingCandidates(LISTING_SAMPLE, ["patch", "update"]).map((c: { position: number }) => c.position);
  assert.deepEqual(ranked, [1, 3, 4, 0, 2],
    "pos1 scor 2; apoi scor 1 dupa data desc (pos3 2024-03-12 inainte de pos4 2023-11-20); apoi scor 0 dupa data (pos0 2024-01-05 inainte de pos2 fara data)");
});

test("rankListingCandidates: fara keywords cade pe data desc apoi pozitie", () => {
  const ranked = rankListingCandidates(LISTING_SAMPLE, []).map((c: { position: number }) => c.position);
  assert.deepEqual(ranked, [1, 3, 0, 4, 2],
    "toate scor 0 -> pur data desc (pos1/pos3 acelasi 2024-03-12 -> pozitie asc), apoi pos0 2024-01-05, pos4 2023-11-20, pos2 fara data");
});

test("rankListingCandidates: lista goala -> lista goala", () => {
  assert.deepEqual(rankListingCandidates([], ["patch"]), []);
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

test("Rust isGoodSteamArticleUrl filters CDN/non-http URLs", () => {
  assert.equal(isGoodSteamArticleUrl("https://store.steampowered.com/news/app/730"), true);
  assert.equal(isGoodSteamArticleUrl("http://example.com/article"), true);

  assert.equal(isGoodSteamArticleUrl("https://cdn.steamstatic.com/image.jpg"), false);
  assert.equal(isGoodSteamArticleUrl("https://media.steamcdn.com/image.png"), false);

  assert.equal(isGoodSteamArticleUrl("ftp://foo/bar"), false);
  assert.equal(isGoodSteamArticleUrl(""), false);
  assert.equal(isGoodSteamArticleUrl("   "), false);

  assert.equal(isGoodSteamArticleUrl("HTTPS://CDN.STEAMSTATIC.COM/X"), false);
});

test("Rust extractDateScore returns UTC ms for real dates, 0 for nonsense", () => {

  assert.equal(extractDateScore("https://x/news/2024-01-15/foo"), Date.UTC(2024, 0, 15));
  assert.equal(extractDateScore("https://x/news/2024/01/15/foo"), Date.UTC(2024, 0, 15));

  assert.equal(extractDateScore("https://x/2024-02-29"), Date.UTC(2024, 1, 29));
  assert.equal(extractDateScore("https://x/2023-02-29"), 0);

  assert.equal(extractDateScore("https://x/2024-02-31"), 0);

  assert.equal(extractDateScore("https://x/1999-12-31"), 0);
  assert.equal(extractDateScore("https://x/2101-01-01"), 0);
  assert.equal(extractDateScore("https://x/2024-13-01"), 0);
  assert.equal(extractDateScore("https://x/2024-00-15"), 0);

  assert.equal(extractDateScore("https://x/news/article-name"), 0);
  assert.equal(extractDateScore(""), 0);

  assert.equal(extractDateScore("https://x/archive/1999-05-20-old/2024-05-20-new"), Date.UTC(2024, 4, 20));
  assert.equal(extractDateScore("https://x/5566-77-88/2024-05-20"), Date.UTC(2024, 4, 20));
  assert.equal(extractDateScore("https://x/2024-13-05/2024-05-20"), Date.UTC(2024, 4, 20));
  assert.equal(extractDateScore("https://x/2024-02-31/2023-06-10"), Date.UTC(2023, 5, 10));
});

test("Rust scoreListingCandidate counts case-insensitive keyword hits", () => {
  assert.equal(scoreListingCandidate("https://x/patch-notes-v1.2", "Patch Notes 1.2", ["patch", "notes", "version"]), 2);
  assert.equal(scoreListingCandidate("https://x/news", "Sale ends Friday", ["patch", "update"]), 0);

  assert.equal(scoreListingCandidate("HTTPS://X/UPDATE", "Big PATCH", ["patch", "update"]), 2);

  assert.equal(scoreListingCandidate("https://x", "sample text", []), 0);

  assert.equal(scoreListingCandidate("https://x/patch", "ok", ["", "patch", ""]), 1);
});

test("Rust autocomplete choices score, sort and cap Discord option output", () => {
  const choices = buildAutocompleteChoices(
    [
      { key: "dota2", name: "Dota 2", aliases: ["dota"] },
      { key: "cs2", name: "Counter-Strike 2", aliases: ["cs", "counter strike"] },
      { key: "minecraft", name: "Minecraft", aliases: ["mc"] }
    ],
    "c",
    false,
    20,
    25,
    100,
    100
  );

  assert.deepEqual(choices, [
    { name: "Counter-Strike 2 (cs2)", value: "cs2" },
    { name: "Minecraft (minecraft)", value: "minecraft" }
  ]);

  const nameValue = buildAutocompleteChoices(
    [{ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }],
    "cs",
    true,
    20,
    25,
    12,
    8
  );
  assert.deepEqual(nameValue, [{ name: "Counter-Stri", value: "Counter-" }]);
});

test("Rust cleanText strips tags and decodes entities", () => {

  assert.equal(cleanText("<p>Hello   <b>world</b>!</p>"), "Hello world !");
  assert.equal(cleanText("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(cleanText("It&#39;s &quot;hot&quot;"), "It's \"hot\"");
  assert.equal(cleanText("&NBSP;case-insensitive&AMP;"), "case-insensitive&");
  assert.equal(cleanText("unknown &foo; entity"), "unknown &foo; entity");
  assert.equal(cleanText("  leading\nand\ttrailing  "), "leading and trailing");
  assert.equal(cleanText(""), "");

  assert.equal(cleanText("<span>caf\u00e9 \u2014 \u4e2d\u6587</span>"), "caf\u00e9 \u2014 \u4e2d\u6587");
});

test("Rust stable update ids match SHA256 contract (first 8 bytes, 16 hex)", () => {
  assert.equal(stableUpdateId("Patch", "https://example.com/update"), "c67e53c18e422e9a");
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

test("Rust deal filter applies guild price, discount, store and free/paid gates", () => {
  const guild = {
    _id: "guild-1",
    minDiscountPercent: 30,
    includeFreeGames: true,
    includePaidDiscounts: true,
    maxAbsolutePrice: 15,
    enabledStores: ["Steam"]
  };
  const baseDeal = {
    store: "Steam",
    salePrice: "9.99",
    normalPrice: "19.99",
    savings: 50
  };

  assert.equal(dealPassesFilters(baseDeal, guild), true);
  assert.equal(dealPassesFilters({ ...baseDeal, savings: 10 }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, salePrice: "20" }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, store: "Epic Games" }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, salePrice: "0", savings: undefined }, { ...guild, includeFreeGames: false }), false);
  assert.equal(dealPassesFilters({ ...baseDeal, savings: undefined }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, salePrice: "0", savings: undefined }, guild), true);
});

test("Rust deal hashes preserve stable Steam, Epic and listing keys", () => {
  assert.equal(dealHash({
    store: "Steam",
    steamAppID: 730,
    title: "Counter-Strike 2",
    salePrice: "9.99",
    normalPrice: "19.99",
    savings: "50"
  }), "588c4a3667a42b4bc834e034e908df6f43c5706e4eeca34f00a2c2f32dbd1135");

  assert.equal(dealHash({
    store: "Epic Games",
    id: "epic_abc-123",
    title: "Some Epic Game",
    salePrice: "5.00",
    normalPrice: "10.00",
    savings: "50"
  }), "74c3be8aae2b79f6e5bdb7a4326743ebbd83c35091255edf8cd55e4f4523ca36");

  assert.equal(dealHash({
    store: "Itch.io",
    title: "Some Listing Game!!!",
    salePrice: "7.50",
    normalPrice: "15.00",
    savings: "50"
  }), "565fa75d8132e46c5763d5d933f6cf9c0d52c349a5d03ccf3d85a554deeb5916");
});

export {};
