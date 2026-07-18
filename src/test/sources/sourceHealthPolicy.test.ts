import test from "node:test";
import assert from "node:assert/strict";
import { isCoolingDown, nextCooldown, shouldOpenSourceCircuit } from "../../sources/sourceHealthPolicy.js";

test("source policy distinguishes transient and schema drift thresholds", () => {
  assert.equal(shouldOpenSourceCircuit({ fails: 2, schemaDriftFails: 0, cooldownUntil: null }, "transient", { failures: 2, schemaDrift: 3 }), true);
  assert.equal(shouldOpenSourceCircuit({ fails: 2, schemaDriftFails: 2, cooldownUntil: null }, "schema-drift", { failures: 2, schemaDrift: 3 }), false);
});

test("source policy does not reopen a cooling circuit and computes bounded jitter", () => {
  const now = new Date("2026-07-18T00:00:00Z");
  assert.equal(isCoolingDown({ cooldownUntil: new Date(now.getTime() + 1000) }, now), true);
  assert.equal(nextCooldown(now, 1000, 500, () => 0.5).getTime(), now.getTime() + 1250);
});
