import test from "node:test";
import assert from "node:assert/strict";
import { nativeFallbackAllowed, ensureNativeFuzzy, missingCriticalNativeExports } from "../../native/fuzzy.js";

type NativeLike = Parameters<typeof missingCriticalNativeExports>[0];
const hashFn = () => "";
const baseNative = { levenshtein: () => 0, findGameKeys: () => [] };

test("nativeFallbackAllowed: fallback TS permis in afara productiei", () => {
  assert.equal(nativeFallbackAllowed("development", undefined), true);
  assert.equal(nativeFallbackAllowed("test", undefined), true);
  assert.equal(nativeFallbackAllowed(undefined, undefined), true);
});

test("nativeFallbackAllowed: in productie fallback-ul TS e interzis implicit", () => {
  assert.equal(nativeFallbackAllowed("production", undefined), false);
  assert.equal(nativeFallbackAllowed("production", "false"), false);
  assert.equal(nativeFallbackAllowed("production", ""), false);
});

test("nativeFallbackAllowed: in productie fallback-ul e permis doar cu ALLOW_NATIVE_FALLBACK=true", () => {
  assert.equal(nativeFallbackAllowed("production", "true"), true);
});

test("ensureNativeFuzzy: intoarce un boolean fara sa arunce in mediul de test", () => {
  assert.equal(typeof ensureNativeFuzzy(), "boolean");
});

test("missingCriticalNativeExports: un build complet (hash-uri prezente) nu raporteaza lipsuri", () => {
  const fullCamel: NativeLike = { ...baseNative, stableUpdateId: hashFn, dealHash: hashFn };
  assert.deepEqual(missingCriticalNativeExports(fullCamel), []);
  const fullSnake: NativeLike = { ...baseNative, stable_update_id: hashFn, deal_hash: hashFn };
  assert.deepEqual(missingCriticalNativeExports(fullSnake), [], "varianta snake_case satisface contractul critic");
});

test("missingCriticalNativeExports: un build partial (levenshtein dar fara stableUpdateId) e respins ca incomplet", () => {
  const partial: NativeLike = { ...baseNative, dealHash: hashFn };
  assert.deepEqual(missingCriticalNativeExports(partial), ["stableUpdateId"], "lipsa stableUpdateId e detectata (altfel hash-ul de update ar cadea tacut pe TS -> spam seen)");
  const noHashes: NativeLike = { ...baseNative };
  assert.deepEqual(missingCriticalNativeExports(noHashes), ["stableUpdateId", "dealHash"], "ambele hash-uri critice lipsa sunt raportate");
});
