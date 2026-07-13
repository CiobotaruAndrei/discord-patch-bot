import test from "node:test";
import assert from "node:assert/strict";
import { ALL_MIGRATIONS } from "../../infra/mongo/migrations/registry.js";

test("registry-ul are id-uri unice, contigue 1..N si strict ascendente", () => {
  const ids = ALL_MIGRATIONS.map(m => m.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "id-urile sunt in ordine strict ascendenta in registry");
  assert.equal(new Set(ids).size, ids.length, "id-urile sunt unice");
  assert.deepEqual(ids, Array.from({ length: ids.length }, (_unused, i) => i + 1), "id-urile sunt contigue 1..N (fara gap-uri)");
});

test("fiecare migrare are un name ne-gol si un up executabil", () => {
  for (const migration of ALL_MIGRATIONS) {
    assert.equal(typeof migration.name, "string");
    assert.ok(migration.name.length > 0, `migrarea #${migration.id} are name`);
    assert.equal(typeof migration.up, "function", `migrarea #${migration.id} are up()`);
  }
});
