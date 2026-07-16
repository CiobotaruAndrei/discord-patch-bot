import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";
import { loadAdminAccessDoc, saveAdminAccessRule, deleteAdminAccessRule } from "../../features/command-security/adminAccessRepository.js";
import { parseAdminScopeId } from "../../features/command-security/adminScopeIds.js";
import { upsertPriceAlert, removePriceAlertsForGame, buildPriceAlertRule, MAX_PRICE_ALERTS_PER_GUILD } from "../../features/notifications/priceAlertRepository.js";
import {
  resetGuildConfigurationWithAudit,
  setAdminAlertChannel,
  applyGuildConfigUpdate,
  addWatchlistGame,
  removeWatchlistGame,
  setCommandSnooze,
  setLockedChannel,
  clearCommandSnooze
} from "../../features/guild-config/guildConfigRepository.js";
import { buildResetConfiguration } from "../../features/guild-config/guildConfigDefaults.js";
import type { PriceAlertRule } from "../../types.js";

test("guildConfigRepository: scrierile /set (config/watchlist/snooze) pastreaza forma exacta a fiecarui operator (runda 10)", async () => {
  const calls: Array<{ filter: object; update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const model = {
    updateOne: async (filter: object, update: object, options?: object) => {
      calls.push({ filter, update: update as Record<string, unknown>, options: options as Record<string, unknown> });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };

  await applyGuildConfigUpdate(model, "g1", { notificationMode: "compact", currency: "EUR" });
  assert.deepEqual(calls[0].filter, { _id: "g1" });
  assert.deepEqual(calls[0].update.$set, { notificationMode: "compact", currency: "EUR" });
  assert.equal(calls[0].options?.upsert, true, "config-ul /set face upsert implicit");

  await applyGuildConfigUpdate(model, "g1", { notificationRoleId: null }, { upsert: false });
  assert.equal(calls[1].options?.upsert, false, "eliminarea rolului nu face upsert (paritate cu handler-ul)");

  await addWatchlistGame(model, "g1", "cs2");
  assert.deepEqual(calls[2].update.$addToSet, { enabledGames: "cs2" });
  assert.equal(calls[2].options?.upsert, true);

  const removed = await removeWatchlistGame(model, "g1", "dota");
  assert.deepEqual(calls[3].update.$pull, { enabledGames: "dota" });
  assert.equal(calls[3].options, undefined, "remove-ul nu face upsert");
  assert.equal(removed.modifiedCount, 1, "raporteaza modifiedCount pentru mesajul de negasit din handler");

  await setCommandSnooze(model, "g1", "start:updates", new Date("2026-07-05T12:00:00.000Z"));
  assert.ok(calls[4].update.$set && (calls[4].update.$set as Record<string, unknown>)["commandSnoozes.start:updates"] instanceof Date);
  assert.equal(calls[4].options?.upsert, true);

  await clearCommandSnooze(model, "g1", "start:updates");
  assert.deepEqual(calls[5].update.$unset, { "commandSnoozes.start:updates": "" });
  assert.equal(calls[5].options, undefined, "unsnooze nu face upsert");

  await setLockedChannel(model, "g1", "chan-1", true);
  assert.deepEqual(calls[6].update.$addToSet, { lockedChannelIds: "chan-1" }, "lock-channel adauga in set prin repository, nu prin updateOne brut din handler (review nou, Mare #5)");
  assert.equal(calls[6].options?.upsert, true);

  await setLockedChannel(model, "g1", "chan-1", false);
  assert.deepEqual(calls[7].update.$pull, { lockedChannelIds: "chan-1" }, "unlock-channel scoate din set prin repository");
  assert.equal(calls[7].options?.upsert, true);
});

test("guildConfigRepository: reset-ul scrie valorile implicite cu upsert si auditul in colectia guildAuditLogs (R7 #3 + #6 audit split)", async () => {
  const calls: Array<{ filter: object; update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const auditDocs: GuildAuditLogRecord[] = [];
  const auditModel = {
    create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
  };
  const model = { updateOne: async (filter: object, update: object, options?: object) => { calls.push({ filter, update: update as Record<string, unknown>, options: options as Record<string, unknown> }); return {}; } };
  const errorLogDeletes: Array<Record<string, unknown>> = [];
  const youtubeErrorModel = { deleteMany: async (filter: Record<string, unknown>) => { errorLogDeletes.push(filter); return { deletedCount: 1 }; } };
  const deadLetterDeletes: Array<Record<string, unknown>> = [];
  const deadLetterModel = { deleteMany: async (filter: Record<string, unknown>) => { deadLetterDeletes.push(filter); return { deletedCount: 1 }; } };
  await resetGuildConfigurationWithAudit(model, auditModel, youtubeErrorModel, deadLetterModel, "g1", "EUR", { userId: "u1", action: "reset_config", details: "test" }, "reset:g1:test");
  assert.equal(calls.length, 1, "reset = o singura scriere pe guild, fara $push de audit");
  const setDoc = calls[0].update.$set as Record<string, unknown>;
  assert.equal(setDoc.subscribed, false);
  assert.equal(setDoc.currency, "EUR");
  assert.deepEqual(setDoc, buildResetConfiguration("EUR"), "reset-ul foloseste exact sursa unica de valori implicite");
  assert.equal(calls[0].update.$push, undefined);
  assert.deepEqual(errorLogDeletes, [{ guildId: "g1" }], "reset-ul goleste si jurnalul de erori YouTube din colectia dedicata");
  assert.deepEqual(deadLetterDeletes, [{ guildId: "g1" }], "reset-ul goleste si auditul dead-letter din colectia dedicata");
  assert.equal(auditDocs.length, 1);
  assert.equal(auditDocs[0].kind, "server");
  assert.match(String(auditDocs[0].action), /reset_config/);
  assert.equal(calls[0].options?.upsert, true);

  await setAdminAlertChannel(model, "g1", "c9");
  await setAdminAlertChannel(model, "g1", null);
  assert.deepEqual((calls[1].update.$set as Record<string, unknown>), { adminAlertChannelId: "c9" });
  assert.deepEqual((calls[2].update.$set as Record<string, unknown>), { adminAlertChannelId: null });
  assert.equal(calls[2].options?.upsert, true);
});

test("adminAccessRepository: save/delete scriu regula pe guild si auditul in colectia guildAuditLogs (R6 #6 + #7 + #6 audit split)", async () => {
  const calls: Array<{ filter: object; update: Record<string, unknown> }> = [];
  const auditDocs: GuildAuditLogRecord[] = [];
  const auditModel = {
    create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
  };
  const model = { updateOne: async (filter: object, update: object) => { calls.push({ filter, update: update as Record<string, unknown> }); return {}; } };
  const scope = parseAdminScopeId("/start updates");
  assert.ok(scope, "scope-ul canonic exista in catalogul settable");
  await saveAdminAccessRule(model, auditModel, "g1", {
    scope,
    access: { mode: "role" as const, roleId: "r1", updatedBy: "u1", updatedAt: new Date() },
    legacyKeys: ["start:updates"],
    audit: { userId: "u1", action: "admin_access_set", details: "test" }
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].update.$set, "regula in $set");
  assert.ok(calls[0].update.$unset, "cheile legacy curatate in aceeasi scriere");
  assert.equal(calls[0].update.$push, undefined, "auditul nu mai e $push pe documentul guild");
  assert.match(String(auditDocs[0].action), /admin_access_set/);

  await deleteAdminAccessRule(model, auditModel, "g1", {
    scope: "global",
    lookupKeys: [],
    audit: { userId: "u1", action: "admin_access_delete", details: "global" }
  });
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[1].update.$set as Record<string, unknown>).adminCommandAccess, null);
  assert.match(String(auditDocs[1].action), /admin_access_delete/);
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
