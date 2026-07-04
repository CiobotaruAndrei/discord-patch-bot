import test from "node:test";
import assert from "node:assert/strict";
import { loadAdminAccessDoc, saveAdminAccessRule, deleteAdminAccessRule } from "../features/command-security/adminAccessRepository";
import { upsertPriceAlert, removePriceAlertsForGame, buildPriceAlertRule, MAX_PRICE_ALERTS_PER_GUILD } from "../features/notifications/priceAlertRepository";
import type { PriceAlertRule } from "../types";

test("adminAccessRepository: save/delete scriu regula si auditul intr-un singur updateOne (R6 #6 + #7)", async () => {
  const calls: Array<{ filter: object; update: Record<string, unknown> }> = [];
  const model = { updateOne: async (filter: object, update: object) => { calls.push({ filter, update: update as Record<string, unknown> }); return {}; } };
  await saveAdminAccessRule(model, "g1", {
    scope: "start-stop updates",
    access: { mode: "role" as const, roleId: "r1", updatedBy: "u1", updatedAt: new Date() },
    legacyKeys: ["start:updates"],
    audit: { userId: "u1", action: "admin_access_set", details: "test" }
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].update.$set, "regula in $set");
  assert.ok(calls[0].update.$unset, "cheile legacy curatate in aceeasi scriere");
  assert.match(JSON.stringify(calls[0].update.$push), /admin_access_set/);

  await deleteAdminAccessRule(model, "g1", {
    scope: "global",
    lookupKeys: [],
    audit: { userId: "u1", action: "admin_access_delete", details: "global" }
  });
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[1].update.$set as Record<string, unknown>).adminCommandAccess, null);
  assert.match(JSON.stringify(calls[1].update.$push), /admin_access_delete/);
});

test("adminAccessRepository: loadAdminAccessDoc citeste lean cand exista si intoarce null pe doc lipsa", async () => {
  const withLean = { findOne: () => ({ lean: async () => ({ adminCommandAccess: { mode: "role" as const, roleId: "r1" } }) }) };
  const doc = await loadAdminAccessDoc(withLean, "g1");
  assert.equal(doc?.adminCommandAccess?.roleId, "r1");
  const missing = { findOne: () => Promise.resolve(null) };
  assert.equal(await loadAdminAccessDoc(missing, "g1"), null);
});

test("priceAlertRepository: upsert raporteaza saved pe baza documentului intors, remove intoarce numarul sters", async () => {
  const rule: PriceAlertRule = buildPriceAlertRule({ key: "cs2", name: "CS2" }, 10, "EUR");
  const savedModel = {
    findOneAndUpdate: async () => ({ priceAlerts: [rule] }),
    updateOne: async () => ({ modifiedCount: 1 })
  };
  assert.deepEqual(await upsertPriceAlert(savedModel, "g1", rule), { saved: true });
  const fullModel = {
    findOneAndUpdate: async () => ({ priceAlerts: [] }),
    updateOne: async () => ({ modifiedCount: 0 })
  };
  assert.deepEqual(await upsertPriceAlert(fullModel, "g1", rule, MAX_PRICE_ALERTS_PER_GUILD), { saved: false });
  assert.equal(await removePriceAlertsForGame(fullModel, "g1", "cs2"), 0);
  assert.equal(await removePriceAlertsForGame(savedModel, "g1", "cs2"), 1);
});
