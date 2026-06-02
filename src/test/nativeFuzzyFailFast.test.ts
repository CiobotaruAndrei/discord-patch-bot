import test from "node:test";
import assert from "node:assert/strict";
import { nativeFallbackAllowed, ensureNativeFuzzy } from "../native/fuzzy";

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
