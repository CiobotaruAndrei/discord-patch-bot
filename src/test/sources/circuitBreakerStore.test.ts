import test from "node:test";
import assert from "node:assert/strict";
import { createCircuitBreakerStore } from "../../sources/updates/circuitBreakerStore.js";
import type { CircuitBreakerModelLike } from "../../sources/updates/updatesContracts.js";

function recordingModel() {
  const findOneAndUpdate: Array<{ filter: unknown; update: unknown; options?: unknown }> = [];
  const updateOne: Array<{ filter: unknown; update: unknown }> = [];
  const model: CircuitBreakerModelLike = {
    findOneAndUpdate: async (filter: unknown, update: unknown, options?: unknown) => { findOneAndUpdate.push({ filter, update, options }); return { _id: "g", fails: 3 }; },
    updateOne: async (filter: unknown, update: unknown) => { updateOne.push({ filter, update }); return { matchedCount: 1 }; }
  };
  return { model, findOneAndUpdate, updateOne };
}

test("getOrCreate face upsert idempotent si intoarce documentul (nu null)", async () => {
  const rec = recordingModel();
  const doc = await createCircuitBreakerStore(rec.model).getOrCreate("cs2");
  assert.equal(doc._id, "g");
  assert.deepEqual(rec.findOneAndUpdate[0].filter, { _id: "cs2" });
  assert.deepEqual((rec.findOneAndUpdate[0].options as Record<string, unknown>).upsert, true);
});

test("getOrCreate arunca daca modelul intoarce null (fara document)", async () => {
  const model: CircuitBreakerModelLike = { findOneAndUpdate: async () => null, updateOne: async () => ({}) };
  await assert.rejects(() => createCircuitBreakerStore(model).getOrCreate("cs2"), /lipsa pentru cs2/);
});

test("registerFailure/registerSchemaDrift incrementeaza campul corect", async () => {
  const rec = recordingModel();
  const store = createCircuitBreakerStore(rec.model);
  await store.registerFailure("cs2");
  await store.registerSchemaDrift("cs2");
  assert.deepEqual((rec.findOneAndUpdate[0].update as { $inc: unknown }).$inc, { fails: 1 });
  assert.deepEqual((rec.findOneAndUpdate[1].update as { $inc: unknown }).$inc, { schemaDriftFails: 1 });
});

test("reset/openCircuit/markAlertSent/markSchemaDriftAlertSent scriu $set-ul asteptat", async () => {
  const rec = recordingModel();
  const store = createCircuitBreakerStore(rec.model);
  const until = new Date("2026-07-14T00:00:00Z");
  await store.reset("cs2");
  await store.openCircuit("cs2", until);
  await store.markAlertSent("cs2");
  await store.markSchemaDriftAlertSent("cs2");
  const sets = rec.updateOne.map(u => (u.update as { $set: Record<string, unknown> }).$set);
  assert.deepEqual(sets[0], { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false });
  assert.deepEqual(sets[1], { cooldownUntil: until });
  assert.deepEqual(sets[2], { alertSent: true });
  assert.deepEqual(sets[3], { schemaDriftAlertSent: true });
});
