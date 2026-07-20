import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);

"use strict";

import test from "node:test";
import assert from "node:assert/strict";
const {
  buildAutocompleteChoices,
  buildAutocompleteChoicesFallback,
  classifyPatchNote,
  cleanText,
  dealPassesFilters,
  dealHash,
  extractAndRankListingCandidates,
  extractAndRankListingCandidatesFallback,
  selectLatestSteamPatchNoteIndex,
  selectLatestSteamPatchNoteIndexFallback,
  chooseBestSteamMatchIndex,
  chooseBestSteamMatchIndexFallback,
  dedupeAndRankDealsIndex,
  dedupeAndRankDealsIndexFallback,
  extractDateScore,
  findGameKeys,
  findGameKeysFallback,
  isGoodSteamArticleUrl,
  isRustFuzzyAvailable,
  levenshtein,
  normalizeDealState,
  normalizeTitleForDedupe,
  rankListingCandidates,
  rankListingCandidatesFallback,
  reorderByValidPermutation,
  scoreListingCandidate,
  stableUpdateId
} = require("../../native/fuzzy");

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

const ANCHOR_SAMPLE = [
  { href: "https://x.com/news/2024-01-05/intro", rawText: "  <b>Intro</b>   article  " },
  { href: "https://x.com/news/2024-03-12/big-patch-notes", rawText: "Big patch &amp; update" },
  { href: "https://x.com/blog/no-date-here/teaser", rawText: "Teaser hotfix" },
  { href: "https://x.com/news/2024-03-12/big-patch-notes", rawText: "duplicat cu patch update" },
  { href: "https://x.com/news/2023-11-20/legacy-update", rawText: "Legacy update" }
];

test("extractAndRankListingCandidates: native == fallback pe cazuri variate (paritate)", () => {
  const cases: Array<{ keywords: string[]; max: number }> = [
    { keywords: ["patch", "update"], max: 0 },
    { keywords: ["patch", "update"], max: 2 },
    { keywords: [], max: 0 },
    { keywords: [], max: 3 },
    { keywords: ["inexistent"], max: 0 }
  ];
  for (const { keywords, max } of cases) {
    const native = extractAndRankListingCandidates(ANCHOR_SAMPLE, keywords, max);
    const fallback = extractAndRankListingCandidatesFallback(ANCHOR_SAMPLE, keywords, max);
    assert.deepEqual(native, fallback, `divergenta native/fallback pentru keywords=${JSON.stringify(keywords)} max=${max}`);
  }
});

test("extractAndRankListingCandidates: curata textul, deduplica dupa href, filtreaza scor 0 si ordoneaza", () => {
  const ranked = extractAndRankListingCandidates(ANCHOR_SAMPLE, ["patch", "update"], 0);
  assert.deepEqual(
    ranked.map((c: { href: string }) => c.href),
    ["https://x.com/news/2024-03-12/big-patch-notes", "https://x.com/news/2023-11-20/legacy-update"],
    "intro/teaser scor 0 cad; duplicatul de href e eliminat; scor desc apoi data desc"
  );
  assert.equal(ranked[0].text, "Big patch & update", "textul e curatat de taguri/entitati/spatii inainte de returnare");
});

test("extractAndRankListingCandidates: fara keywords pastreaza tot pe data desc apoi pozitie, deduplicat", () => {
  const ranked = extractAndRankListingCandidates(ANCHOR_SAMPLE, [], 0).map((c: { href: string }) => c.href);
  assert.deepEqual(ranked, [
    "https://x.com/news/2024-03-12/big-patch-notes",
    "https://x.com/news/2024-01-05/intro",
    "https://x.com/news/2023-11-20/legacy-update",
    "https://x.com/blog/no-date-here/teaser"
  ]);
});

test("extractAndRankListingCandidates: max_results taie la cei mai buni; lista goala -> gol", () => {
  assert.equal(extractAndRankListingCandidates(ANCHOR_SAMPLE, [], 2).length, 2);
  assert.deepEqual(extractAndRankListingCandidates([], ["patch"], 0), []);
});

const STEAM_SAMPLE = [
  { gid: "1", title: "Summer Sale", url: "https://store.steampowered.com/news/1", contents: "reduceri", tags: [], feed_type: 1, feedname: "", date: 300 },
  { gid: "2", title: "Patch 1.2 notes", url: "https://store.steampowered.com/news/2", contents: "bug fixes", tags: [], feed_type: 1, feedname: "", date: 100 },
  { gid: "3", title: "Hotfix build", url: "https://cdn.steamstatic.com/img.png", contents: "", tags: [], feed_type: 1, feedname: "", date: 999 },
  { gid: "4", title: "Update notes", url: "https://store.steampowered.com/news/4", contents: "", tags: ["patchnotes"], feed_type: 7, feedname: "steam_community_announcements", date: 200 },
  { gid: "5", title: "Season launch", url: "https://store.steampowered.com/news/5", contents: "content update", tags: [], feed_type: 1, feedname: "", date: 150 }
];

test("selectLatestSteamPatchNoteIndex: wrapper-ul deleaga la implementarea TS (TS-primary, Rust pierde la marshaling)", () => {
  const cases = [
    STEAM_SAMPLE,
    [],
    [{ gid: "x", title: "Community giveaway", url: "https://store.steampowered.com/news/x", contents: "", tags: [], feed_type: 1, feedname: "", date: 10 }],
    STEAM_SAMPLE.map(item => ({ ...item, feed_type: 9 })),
    STEAM_SAMPLE.map((item, i) => ({ ...item, date: i === 1 ? 200 : item.date }))
  ];
  for (const items of cases) {
    assert.equal(
      selectLatestSteamPatchNoteIndex(items),
      selectLatestSteamPatchNoteIndexFallback(items),
      `wrapper-ul trebuie sa dea acelasi rezultat ca implementarea TS pentru ${JSON.stringify(items.map(i => [i.feed_type, i.feedname, i.date]))}`
    );
  }
});

test("selectLatestSteamPatchNoteIndex: alege cel mai nou patch note valid, respinge sale/CDN/feed gresit", () => {
  assert.equal(selectLatestSteamPatchNoteIndex(STEAM_SAMPLE), 3,
    "index 4 (feedname community + tag patchnotes, data 200) bate index 2 (data 100) si index 5 (data 150); sale respins de clasificare, CDN respins de URL");
  assert.equal(selectLatestSteamPatchNoteIndex([]), -1, "feed gol -> -1");
});

test("selectLatestSteamPatchNoteIndex: la data egala pastreaza prima aparitie", () => {
  const tied = [
    { gid: "a", title: "Patch A", url: "https://store.steampowered.com/news/a", contents: "", tags: [], feed_type: 1, feedname: "", date: 500 },
    { gid: "b", title: "Patch B", url: "https://store.steampowered.com/news/b", contents: "", tags: [], feed_type: 1, feedname: "", date: 500 }
  ];
  assert.equal(selectLatestSteamPatchNoteIndex(tied), 0);
});

const STEAM_MATCH_SAMPLE = [
  { name: "The Witcher 3: Wild Hunt", type: "game" },
  { name: "The Witcher 3: Wild Hunt - Hearts of Stone", type: "dlc" },
  { name: "The Witcher 3: Wild Hunt Soundtrack", type: "music" },
  { name: "The Witcher 2: Assassins of Kings", type: "game" },
  { name: "The Witcher 3: Wild Hunt - Game of the Year Edition", type: "game" }
];

test("chooseBestSteamMatchIndex: native == fallback pe interogari variate (paritate)", () => {
  const cases: Array<{ query: string; force: boolean }> = [
    { query: "The Witcher 3: Wild Hunt", force: true },
    { query: "witcher 3 wild hunt", force: true },
    { query: "witcher 3 soundtrack", force: false },
    { query: "witcher 3 goty dlc", force: true },
    { query: "witcher", force: true },
    { query: "", force: false }
  ];
  for (const { query, force } of cases) {
    assert.equal(
      chooseBestSteamMatchIndex(STEAM_MATCH_SAMPLE, query, force),
      chooseBestSteamMatchIndexFallback(STEAM_MATCH_SAMPLE, query, force),
      `divergenta native/fallback pentru query="${query}" force=${force}`
    );
  }
});

test("chooseBestSteamMatchIndex: potrivire exacta si force-game-only", () => {
  assert.equal(chooseBestSteamMatchIndex(STEAM_MATCH_SAMPLE, "The Witcher 3: Wild Hunt", true), 0, "potrivirea exacta pe joc castiga");
  assert.equal(chooseBestSteamMatchIndex(STEAM_MATCH_SAMPLE, "witcher 3 wild hunt", true), 0, "force_game_only tine DLC/soundtrack in afara, jocul de baza castiga");
  assert.equal(chooseBestSteamMatchIndex([], "orice", false), -1, "lista goala -> -1");
});

const DEAL_SAMPLE = [
  { title: "Hades", popularityScore: 30, id: "a" },
  { title: "Celeste", popularityScore: 80, id: "b" },
  { title: "Hades™", popularityScore: 90, id: "c" },
  { title: "Stardew Valley", popularityScore: 50, id: "d" }
];

test("dedupeAndRankDealsIndex: deduplica dupa titlu normalizat (scor mai mare) si ordoneaza descrescator", () => {
  assert.deepEqual(dedupeAndRankDealsIndex(DEAL_SAMPLE, 0), [2, 1, 3],
    "Hades dedus la scorul 90 (index 2), apoi 80 (Celeste), apoi 50 (Stardew); duplicatul Hades de scor 30 cade");
  assert.deepEqual(dedupeAndRankDealsIndex(DEAL_SAMPLE, 2), [2, 1], "maxDeals taie la primii 2");
});

test("dedupeAndRankDealsIndex: titlu care se normalizeaza la gol foloseste id-ul", () => {
  const deals = [
    { title: "!!!", popularityScore: 10, id: "x" },
    { title: "@@@", popularityScore: 20, id: "y" }
  ];
  assert.deepEqual(dedupeAndRankDealsIndex(deals, 0), [1, 0], "cheile devin id-urile; sort desc pe scor: 20, 10");
  assert.deepEqual(dedupeAndRankDealsIndex([], 5), [], "lista goala -> gol");
});

test("dedupeAndRankDealsIndex: wrapper-ul deleaga la implementarea TS (TS-primary, Rust pierde la marshaling)", () => {
  const candidates = DEAL_SAMPLE.map(deal => ({ title: deal.title, popularityScore: deal.popularityScore, fallbackId: String(deal.id) }));
  assert.deepEqual(dedupeAndRankDealsIndex(DEAL_SAMPLE, 3), dedupeAndRankDealsIndexFallback(candidates, 3));
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

test("findGameKeys: wrapper-ul nativ == fallback pe input-uri variate (paritate, ca sa fie sigura rutarea Rust)", () => {
  const inputs = ["counter", "counterstrike", "counter strike", "cs2", "cs", "rocket_league", "rocket league",
    "minikraft", "minecraft", "mc", "xyz-nope", "", "  ", "c", "co", "roket"];
  for (const text of inputs) {
    for (const maxInput of [80, 100]) {
      assert.deepEqual(findGameKeys(text, games, maxInput), findGameKeysFallback(text, games, maxInput),
        `findGameKeys diverge intre native si fallback pentru "${text}" (maxInput=${maxInput})`);
    }
  }
});

test("buildAutocompleteChoices: wrapper-ul nativ == fallback, inclusiv ordinea la scoruri egale (paritate)", () => {
  const inputs = ["", "c", "co", "cou", "counter", "counter strike", "cs", "rocket", "min", "mc", "r", "z", "  "];
  for (const input of inputs) {
    for (const useNameAsValue of [true, false]) {
      for (const minRel of [0, 1, 30]) {
        for (const maxChoices of [25, 2]) {
          assert.deepEqual(
            buildAutocompleteChoices(games, input, useNameAsValue, minRel, maxChoices, 100, 100),
            buildAutocompleteChoicesFallback(games, input, useNameAsValue, minRel, maxChoices, 100, 100),
            `buildAutocompleteChoices diverge intre native si fallback pentru "${input}" (nameVal=${useNameAsValue}, minRel=${minRel}, max=${maxChoices})`);
        }
      }
    }
  }
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

test("reorderByValidPermutation: reordoneaza dupa o permutare valida", () => {
  assert.deepEqual(reorderByValidPermutation(["a", "b", "c"], [2, 0, 1]), ["c", "a", "b"]);
  assert.deepEqual(reorderByValidPermutation(["a", "b", "c"], [0, 1, 2]), ["a", "b", "c"]);
});

test("reorderByValidPermutation: respinge indicii invalizi (out-of-range / NaN / duplicat / lungime gresita)", () => {
  assert.equal(reorderByValidPermutation(["a", "b", "c"], [0, 1, 3]), null, "index in afara range-ului");
  assert.equal(reorderByValidPermutation(["a", "b", "c"], [0, 1, -1]), null, "index negativ");
  assert.equal(reorderByValidPermutation(["a", "b", "c"], [0, 1, NaN]), null, "NaN");
  assert.equal(reorderByValidPermutation(["a", "b", "c"], [0, 0, 1]), null, "index duplicat");
  assert.equal(reorderByValidPermutation(["a", "b", "c"], [1.5, 0, 2]), null, "index non-intreg");
  assert.equal(reorderByValidPermutation(["a", "b", "c"], [0, 1]), null, "lungime diferita");
});

test("rankListingCandidates: nu introduce undefined cand ordonarea (nativa) ar fi invalida - cade pe fallback corect", () => {
  const ranked = rankListingCandidates(LISTING_SAMPLE, ["intro"]);
  assert.equal(ranked.length, LISTING_SAMPLE.length, "lungime pastrata");
  assert.ok(ranked.every((c: unknown) => c !== undefined), "niciun element undefined in rezultat");
});

export {};
