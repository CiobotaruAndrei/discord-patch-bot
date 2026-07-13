import test from "node:test";
import assert from "node:assert/strict";

import { buildCoalesceSignature } from "../../sources/updates/coalesceSignature.js";
import type { GameConfig } from "../../types.js";

function game(over: Partial<GameConfig>): GameConfig {
  return { key: "cs2", name: "Counter-Strike 2", ...over };
}

test("identical configs produce the same signature", () => {
  const a = buildCoalesceSignature([game({ url: "https://a.example/news" })]);
  const b = buildCoalesceSignature([game({ url: "https://a.example/news" })]);
  assert.equal(a, b);
});

test("signature is order-independent across the game list", () => {
  const g1 = game({ key: "cs2", url: "https://a.example" });
  const g2 = game({ key: "dota2", url: "https://b.example" });
  assert.equal(buildCoalesceSignature([g1, g2]), buildCoalesceSignature([g2, g1]));
});

test("different url for the same key changes the signature", () => {
  const before = buildCoalesceSignature([game({ url: "https://old.example/news" })]);
  const after = buildCoalesceSignature([game({ url: "https://new.example/news" })]);
  assert.notEqual(before, after);
});

test("different source type changes the signature", () => {
  const before = buildCoalesceSignature([game({ type: "steam" })]);
  const after = buildCoalesceSignature([game({ type: "listing_based" })]);
  assert.notEqual(before, after);
});

test("different appId changes the signature", () => {
  const before = buildCoalesceSignature([game({ appId: "730" })]);
  const after = buildCoalesceSignature([game({ appId: "570" })]);
  assert.notEqual(before, after);
});

test("different listingUrls change the signature", () => {
  const before = buildCoalesceSignature([game({ listingUrls: ["https://a.example"] })]);
  const after = buildCoalesceSignature([game({ listingUrls: ["https://a.example", "https://b.example"] })]);
  assert.notEqual(before, after);
});

test("different fallbacks change the signature even with the same key", () => {
  const before = buildCoalesceSignature([game({ fallbacks: [{ type: "steam", url: "https://a.example" }] })]);
  const after = buildCoalesceSignature([game({ fallbacks: [{ type: "steam", url: "https://b.example" }] })]);
  assert.notEqual(before, after);
});

test("same keys but reordered listingUrls still differ (config drift is detected)", () => {
  const before = buildCoalesceSignature([game({ listingUrls: ["https://a.example", "https://b.example"] })]);
  const after = buildCoalesceSignature([game({ listingUrls: ["https://b.example", "https://a.example"] })]);
  assert.notEqual(before, after);
});
