import test from "node:test";
import assert from "node:assert/strict";

import * as fuzzy from "../../native/fuzzy.js";
import * as bridge from "../../native/fuzzyNativeBridge.js";
import * as fallbacks from "../../native/fuzzyFallbacks.js";
import * as metrics from "../../native/fuzzyFallbackMetrics.js";

test("API-ul public din fuzzy re-exporta exact implementarile din modulele de domeniu (aceeasi referinta)", () => {
  assert.equal(fuzzy.HASH_VERSION, fallbacks.HASH_VERSION);
  assert.equal(fuzzy.levenshteinFallback, fallbacks.levenshteinFallback);
  assert.equal(fuzzy.buildAutocompleteChoicesFallback, fallbacks.buildAutocompleteChoicesFallback);
  assert.equal(fuzzy.stableUpdateIdFallback, fallbacks.stableUpdateIdFallback);
  assert.equal(fuzzy.dealPassesFiltersFallback, fallbacks.dealPassesFiltersFallback);
  assert.equal(fuzzy.dealHashFallback, fallbacks.dealHashFallback);
  assert.equal(fuzzy.findGameKeysFallback, fallbacks.findGameKeysFallback);
  assert.equal(fuzzy.rankListingCandidatesFallback, fallbacks.rankListingCandidatesFallback);
  assert.equal(fuzzy.reorderByValidPermutation, fallbacks.reorderByValidPermutation);
  assert.equal(fuzzy.ensureNativeFuzzy, bridge.ensureNativeFuzzy);
  assert.equal(fuzzy.getNativeFuzzy, bridge.getNativeFuzzy);
  assert.equal(fuzzy.isRustFuzzyAvailable, bridge.isRustFuzzyAvailable);
  assert.equal(fuzzy.missingCriticalNativeExports, bridge.missingCriticalNativeExports);
  assert.equal(fuzzy.nativeFallbackAllowed, bridge.nativeFallbackAllowed);
  assert.equal(fuzzy.recordNativeFallback, metrics.recordNativeFallback);
  assert.equal(fuzzy.getNativeFallbackTotals, metrics.getNativeFallbackTotals);
  assert.equal(fuzzy.getNativeFallbackTotal, metrics.getNativeFallbackTotal);
  assert.equal(fuzzy.resetNativeFallbackTotals, metrics.resetNativeFallbackTotals);
  assert.equal(fuzzy.NATIVE_FALLBACK_FUNCTIONS, metrics.NATIVE_FALLBACK_FUNCTIONS);
});

test("bridge-ul si API-ul public folosesc acelasi modul nativ incarcat (stare partajata, nu doua incarcari)", () => {
  const fromBridge = bridge.getNativeFuzzy();
  const fromPublic = fuzzy.getNativeFuzzy();
  assert.equal(fromBridge, fromPublic);
  assert.equal(fuzzy.isRustFuzzyAvailable(), fromBridge !== null);
});

test("wrapper-ele publice si fallback-urile raman coerente pe un exemplu real", () => {
  const deal = { store: "Steam", steamAppID: "123", salePrice: "5", normalPrice: "10", savings: "50", title: "Joc" };
  assert.equal(typeof fuzzy.dealHash(deal), "string");
  assert.equal(fuzzy.dealHashFallback(deal), fallbacks.dealHashFallback(deal));
  assert.deepEqual(
    fuzzy.findGameKeys("minecraft", [{ key: "minecraft", name: "Minecraft" }], 64),
    { gameKey: "minecraft", suggestionKey: null }
  );
});
