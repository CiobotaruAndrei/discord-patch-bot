import test from "node:test";
import assert from "node:assert/strict";

const fuzzy = require("../native/fuzzy") as {
  recordNativeFallback: (fnName: string, err: unknown) => void;
  getNativeFallbackTotals: () => Record<string, number>;
  getNativeFallbackTotal: () => number;
  resetNativeFallbackTotals: () => void;
  classifyPatchNote: (title: unknown, contents: unknown, tags: unknown) => boolean;
  extractDateScore: (url: unknown) => number;
  NATIVE_FALLBACK_FUNCTIONS: string[];
};

test("recordNativeFallback: numara per-functie si agregat", () => {
  fuzzy.resetNativeFallbackTotals();
  assert.equal(fuzzy.getNativeFallbackTotal(), 0, "reset -> 0");

  fuzzy.recordNativeFallback("classifyPatchNote", new Error("boom"));
  fuzzy.recordNativeFallback("classifyPatchNote", new Error("boom2"));
  fuzzy.recordNativeFallback("findGameKeys", new Error("x"));

  const totals = fuzzy.getNativeFallbackTotals();
  assert.equal(totals.classifyPatchNote, 2, "classifyPatchNote numarat de 2 ori");
  assert.equal(totals.findGameKeys, 1, "findGameKeys numarat o data");
  assert.equal(fuzzy.getNativeFallbackTotal(), 3, "agregatul insumeaza toate functiile");
});

test("recordNativeFallback: log-ul este throttled per functie (o data per fereastra), dar counter-ul creste mereu", () => {
  fuzzy.resetNativeFallbackTotals();
  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = () => { warnCount++; };
  try {
    fuzzy.recordNativeFallback("scoreListingCandidate", new Error("a"));
    fuzzy.recordNativeFallback("scoreListingCandidate", new Error("b"));
    fuzzy.recordNativeFallback("scoreListingCandidate", new Error("c"));
    fuzzy.recordNativeFallback("extractDateScore", new Error("d"));
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnCount, 2, "log o singura data per functie in fereastra (scoreListingCandidate + extractDateScore)");
  assert.equal(fuzzy.getNativeFallbackTotals().scoreListingCandidate, 3, "counter-ul creste la fiecare fallback, chiar daca log-ul e throttled");
});

test("NATIVE_FALLBACK_FUNCTIONS enumera doar functiile inca native-primary (cele care pot face fallback)", () => {
  for (const fn of ["classifyPatchNote", "scoreListingCandidate", "isGoodSteamArticleUrl", "extractDateScore"]) {
    assert.ok(fuzzy.NATIVE_FALLBACK_FUNCTIONS.includes(fn), `lista canonica include ${fn}`);
  }
  assert.equal(fuzzy.NATIVE_FALLBACK_FUNCTIONS.length, 4);
  for (const tsPrimary of ["findGameKeys", "buildAutocompleteChoices", "dealPassesFilters"]) {
    assert.ok(!fuzzy.NATIVE_FALLBACK_FUNCTIONS.includes(tsPrimary), `${tsPrimary} este TS-primary, nu mai face fallback nativ`);
  }
});

test("functiile cu fallback raman corecte si nu incrementeaza counter-ul cand nativul nu arunca", () => {
  fuzzy.resetNativeFallbackTotals();
  assert.equal(fuzzy.classifyPatchNote("Update v1.2 patch notes", "bug fixes", []), true, "titlu de patch note -> true");
  assert.equal(fuzzy.classifyPatchNote("Community tournament", "", []), false, "titlu non-patch -> false");
  assert.equal(typeof fuzzy.extractDateScore("https://x.test/2024-05-20/post"), "number", "extractDateScore returneaza numar");
  assert.equal(fuzzy.getNativeFallbackTotal(), 0, "apel reusit (nativ sau absent) nu incrementeaza counter-ul de esecuri native");
});
