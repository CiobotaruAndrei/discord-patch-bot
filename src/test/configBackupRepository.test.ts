import test from "node:test";
import assert from "node:assert/strict";

import type { CurrencyRegistry, GuildSettings, RuntimeEnv } from "../types";
import {
  CONFIG_BACKUP_KEYS,
  GUILD_SETTINGS_FIELD_ROLES,
  buildConfigRestoreUpdate,
  buildConfigSnapshot,
  findBackup,
  listBackups,
  loadConfigBackup,
  normalizeBackupName,
  saveConfigBackup
} from "../features/admin-records/configBackupRepository";

import mongoose = require("mongoose");
const attachModels = require("../infra/mongo/models") as typeof import("../infra/mongo/models");

let cachedGuildFields: Set<string> | null = null;

function guildSchemaTopLevelFields(): Set<string> {
  if (cachedGuildFields) return cachedGuildFields;
  const built = attachModels.buildFrom({
    mongoose,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} } as CurrencyRegistry,
    DEFAULT_CURRENCY: "EUR",
    ONE_DAY_MS: 86_400_000,
    env: {
      GUILD_SEEN_DISCOUNT_TTL_DAYS: 60,
      NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24,
      NOTIFICATION_HISTORY_TTL_DAYS: 30,
      FEEDBACK_REPORT_TTL_DAYS: 90,
      NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7
    } as RuntimeEnv
  });
  const fields = new Set<string>();
  for (const path of Object.keys(built.GuildModel.schema.paths)) {
    const field = path.split(".")[0];
    if (field !== "_id" && field !== "__v") fields.add(field);
  }
  cachedGuildFields = fields;
  return fields;
}

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options?: Record<string, unknown>;
};

function makeGuildModel() {
  const calls: MongoCall[] = [];
  return {
    model: {
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    calls
  };
}

test("clasificarea campurilor din guildSchema e BIDIRECTIONALA cu schema reala (derivat din schema, nu lista manuala) (R[Arh] #10)", () => {
  const schemaFields = guildSchemaTopLevelFields();
  for (const field of schemaFields) {
    assert.ok(
      field in GUILD_SETTINGS_FIELD_ROLES,
      `campul de schema "${field}" nu e clasificat in GUILD_SETTINGS_FIELD_ROLES — decide daca intra in backup (config), e regula de securitate sau stare operationala`
    );
  }
  for (const field of Object.keys(GUILD_SETTINGS_FIELD_ROLES)) {
    assert.ok(schemaFields.has(field), `GUILD_SETTINGS_FIELD_ROLES clasifica un camp inexistent in schema (stale): ${field}`);
  }
});

test("CONFIG_BACKUP_KEYS e derivat din clasificare: doar campurile config, fara stare operationala sau reguli de securitate", () => {
  const expected = Object.entries(GUILD_SETTINGS_FIELD_ROLES)
    .filter(([, role]) => role === "config")
    .map(([field]) => field);
  assert.deepEqual([...CONFIG_BACKUP_KEYS], expected, "lista de backup e exact multimea campurilor clasificate config");
  assert.ok(CONFIG_BACKUP_KEYS.includes("dlcChannelId"), "configuratia stabila DLC e in backup");
  assert.ok(CONFIG_BACKUP_KEYS.includes("youtubeFilters"), "filtrele YouTube (config) sunt in backup");
  for (const excluded of ["dlcInitializing", "dlcActivationId", "botAuditLog", "configBackups", "pendingDiscounts"]) {
    assert.equal(CONFIG_BACKUP_KEYS.includes(excluded), false, `${excluded} e stare operationala, nu intra in backup`);
  }
  for (const securityField of ["adminCommandAccess", "adminCommandAccessByCommand"]) {
    assert.equal(CONFIG_BACKUP_KEYS.includes(securityField), false, `${securityField} e regula de securitate owner-only; /backup load (admin-level) nu are voie sa o rescrie`);
  }
});

test("backup-ul normalizeaza numele si copiaza doar configuratia botului", async () => {
  const { model, calls } = makeGuildModel();
  const settings: GuildSettings = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "updates",
    botAuditLog: [{ userId: "u1", command: "/x", result: "ok", serverId: "guild-1", at: new Date() }],
    serverAuditLog: [{ userId: "u1", action: "x", serverId: "guild-1", at: new Date() }],
    suggestedCommands: [{ commandName: "x", description: "y", createdBy: "u1", createdAt: new Date() }]
  };

  const record = await saveConfigBackup(model, "guild-1", " Inainte De Test ", "user-1", settings);

  assert.equal(record.name, "inainte-de-test");
  assert.equal(record.snapshot.subscribed, true);
  assert.equal(record.snapshot.notificationChannelId, "updates");
  assert.equal(record.snapshot.botAuditLog, undefined);
  assert.equal(calls.length, 1, "salvarea e o singura operatie atomica (pipeline), nu $pull + $push separate");
  assert.deepEqual(calls[0].options, { upsert: true });
  const serialized = JSON.stringify(calls[0].update);
  assert.match(serialized, /configBackups/);
  assert.match(serialized, /inainte-de-test/);
  assert.match(serialized, /\$slice/, "pipeline-ul filtreaza acelasi nume si limiteaza prin $slice intr-un singur update");
});

test("backup-ul nu include starea operationala tranzitorie (dlc/future-release init + activationId)", () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    subscribed: true,
    dlcSubscribed: true,
    dlcChannelId: "dlc-chan",
    dlcInitializing: true,
    dlcActivationId: "act-dlc-123",
    futureReleaseSubscribed: true,
    futureReleaseChannelId: "fr-chan",
    futureReleaseInitializing: true,
    futureReleaseActivationId: "act-fr-456"
  };

  const snapshot = buildConfigSnapshot(settings);
  assert.equal(snapshot.dlcSubscribed, true, "configuratia stabila DLC se pastreaza");
  assert.equal(snapshot.dlcChannelId, "dlc-chan", "canalul DLC e configuratie stabila");
  assert.equal(snapshot.futureReleaseChannelId, "fr-chan", "canalul future-release e configuratie stabila");
  for (const key of ["dlcInitializing", "dlcActivationId", "futureReleaseInitializing", "futureReleaseActivationId"]) {
    assert.equal(key in snapshot, false, `${key} e stare operationala tranzitorie, nu trebuie salvata in backup`);
  }

  const update = buildConfigRestoreUpdate({ name: "v", createdBy: "u", createdAt: new Date(), snapshot }) as {
    $set?: Record<string, unknown>;
    $unset?: Record<string, string>;
  };
  for (const key of ["dlcInitializing", "dlcActivationId", "futureReleaseInitializing", "futureReleaseActivationId"]) {
    assert.equal(key in (update.$set ?? {}), false, `restore nu seteaza ${key} (stare vie, nu se restaureaza)`);
    assert.equal(key in (update.$unset ?? {}), false, `restore nu sterge ${key} (nu atinge starea operationala vie)`);
  }
});

test("load si listarile folosesc snapshot-uri si ordonare descendenta", async () => {
  const { model, calls } = makeGuildModel();
  const older = { name: "old", createdBy: "u1", createdAt: "2024-01-01T00:00:00.000Z", snapshot: { subscribed: false } };
  const newer = { name: "new", createdBy: "u2", createdAt: "2025-01-01T00:00:00.000Z", snapshot: { subscribed: true } };
  const settings: GuildSettings = { _id: "guild-1", configBackups: [older, newer] };

  assert.equal(normalizeBackupName("  Nume Mare  "), "nume-mare");
  assert.deepEqual(buildConfigSnapshot(null), {});
  assert.equal(findBackup(settings, "NEW")?.createdBy, "u2");
  assert.deepEqual(listBackups(settings).map(backup => backup.name), ["new", "old"]);

  await loadConfigBackup(model, "guild-1", newer);

  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(calls[0].options, { upsert: true });
  const update = calls[0].update as { $set?: Record<string, unknown>; $unset?: Record<string, string> };
  assert.deepEqual(update.$set, { subscribed: true }, "cheia din snapshot se seteaza");
  assert.equal(update.$unset?.youtubeChannelRoutes, "", "cheile absente din snapshot se curata (restore complet, nu doar $set)");
});

test("buildConfigRestoreUpdate face $unset pentru cheile lipsa din snapshot, nu doar $set (restore complet)", () => {
  const update = buildConfigRestoreUpdate({
    name: "vechi",
    createdBy: "user-1",
    createdAt: new Date(),
    snapshot: { subscribed: true, currency: "EUR" }
  }) as { $set?: Record<string, unknown>; $unset?: Record<string, string> };

  assert.deepEqual(update.$set, { subscribed: true, currency: "EUR" }, "cheile din snapshot se seteaza");
  assert.ok(update.$unset, "exista $unset pentru cheile care lipsesc din snapshot");
  for (const key of ["youtubeChannelRoutes", "priceAlerts", "commandSnoozes", "enabledGames"]) {
    assert.equal(update.$unset?.[key], "", `${key} (adaugat dupa backup) e curatat la restore, nu lasat activ`);
  }
  assert.equal("subscribed" in (update.$unset ?? {}), false, "o cheie din snapshot nu apare si in $unset");
});
