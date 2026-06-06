import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCanary } from "../scripts/canarySources";
import type { CanaryGameResult } from "../scripts/canarySources";

const r = (key: string, type: string, ok: boolean): CanaryGameResult => ({ key, type, ok });

test("summarizeCanary: o sursa cu cel putin un joc OK NU e considerata rupta (esec partial = tranzitoriu)", () => {
  const out = summarizeCanary([r("a", "steam", true), r("b", "steam", false)], true, 12);
  const steam = out.byType.find(t => t.type === "steam")!;
  assert.equal(steam.ok, 1);
  assert.equal(steam.failed, 1);
  assert.equal(steam.brokenSource, false);
  assert.equal(out.pass, true);
  assert.deepEqual(out.failures, []);
});

test("summarizeCanary: o sursa cu 0 jocuri OK e marcata rupta si pica", () => {
  const out = summarizeCanary([r("x", "listing_based", false), r("y", "listing_based", false)], true, 5);
  const listing = out.byType.find(t => t.type === "listing_based")!;
  assert.equal(listing.brokenSource, true);
  assert.equal(out.pass, false);
  assert.match(out.failures[0], /listing_based/);
});

test("summarizeCanary: tip cu un singur joc esuat e considerat rupt (canary alerteaza, non-blocking)", () => {
  const out = summarizeCanary([r("fortnite", "epic_games", false)], true, 8);
  assert.equal(out.byType.find(t => t.type === "epic_games")!.brokenSource, true);
  assert.equal(out.pass, false);
});

test("summarizeCanary: deals esuat -> failure dedicata, chiar daca sursele de update sunt OK", () => {
  const out = summarizeCanary([r("a", "steam", true)], false, 0);
  assert.equal(out.dealsOk, false);
  assert.equal(out.pass, false);
  assert.ok(out.failures.some(f => /reduceri|fetchDeals/.test(f)));
});

test("summarizeCanary: toate sursele OK + deals OK -> pass, fara failures", () => {
  const out = summarizeCanary([r("a", "steam", true), r("b", "steam", true), r("fortnite", "epic_games", true)], true, 20);
  assert.equal(out.pass, true);
  assert.deepEqual(out.failures, []);
  assert.equal(out.dealsCount, 20);
});

test("summarizeCanary: agrega corect mai multe jocuri per tip", () => {
  const out = summarizeCanary([r("a", "steam", true), r("b", "steam", true), r("c", "steam", false)], true, 3);
  const steam = out.byType.find(t => t.type === "steam")!;
  assert.equal(steam.total, 3);
  assert.equal(steam.ok, 2);
  assert.equal(steam.failed, 1);
  assert.equal(steam.brokenSource, false);
});
