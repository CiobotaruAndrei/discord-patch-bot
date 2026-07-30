import test from "node:test";
import assert from "node:assert/strict";

import type { CurrencyRegistry } from "../../types.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import {
  CONFIG_BACKUP_KEYS,
  GUILD_SETTINGS_FIELD_ROLES,
  MAX_CONFIG_BACKUPS,
  buildConfigRestoreUpdate,
  buildConfigSnapshot,
  deleteConfigBackup,
  findConfigBackup,
  findNewestConfigBackup,
  listConfigBackups,
  loadConfigBackup,
  normalizeBackupName,
  saveConfigBackup,
  type GuildConfigBackupRecord
} from "../../features/admin-records/configBackupRepository.js";

import mongoose from "mongoose";
import attachModels from "../../infra/mongo/models.js";

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
      GUILD_AUDIT_LOG_TTL_DAYS: 180,
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

function makeBackupModel(initial: GuildConfigBackupRecord[] = []) {
  const docs: GuildConfigBackupRecord[] = [...initial];
  const model = {
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
      const existing = docs.find(doc => doc.guildId === filter.guildId && doc.name === filter.name);
      const set = (update.$set ?? {}) as Partial<GuildConfigBackupRecord>;
      if (existing) {
        Object.assign(existing, set);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options?.upsert === true) {
        docs.push({ guildId: String(filter.guildId), name: String(filter.name), ...set });
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const index = docs.findIndex(doc => doc.guildId === filter.guildId && doc.name === filter.name);
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      const names = (filter.name as { $in: string[] }).$in;
      const before = docs.length;
      for (const name of names) {
        const index = docs.findIndex(doc => doc.guildId === filter.guildId && doc.name === name);
        if (index >= 0) docs.splice(index, 1);
      }
      return { deletedCount: before - docs.length };
    },
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: (spec: Record<string, 1 | -1>) => {
          const direction = spec.createdAt === 1 ? 1 : -1;
          sorted = [...sorted].sort((a, b) => direction * (new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()));
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    },
    findOne: (filter: Record<string, unknown>) => ({
      lean: async () => docs.find(doc => doc.guildId === filter.guildId && doc.name === filter.name) ?? null
    })
  };
  return { model, docs };
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
  const backupKeySet = new Set<string>(CONFIG_BACKUP_KEYS);
  assert.ok(CONFIG_BACKUP_KEYS.includes("dlcChannelId"), "configuratia stabila DLC e in backup");
  assert.ok(CONFIG_BACKUP_KEYS.includes("youtubeFilters"), "filtrele YouTube (config) sunt in backup");
  for (const excluded of ["dlcInitializing", "dlcActivationId", "botAuditLog", "configBackups", "pendingDiscounts"]) {
    assert.equal(backupKeySet.has(excluded), false, `${excluded} nu e configuratie stabila, nu intra in backup`);
  }
  for (const securityField of ["adminCommandAccess", "adminCommandAccessByCommand"]) {
    assert.equal(backupKeySet.has(securityField), false, `${securityField} e regula de securitate owner-only; /backup load (admin-level) nu are voie sa o rescrie`);
  }
});

test("backup-ul normalizeaza numele, copiaza doar configuratia si face upsert pe cheia naturala (guildId, name) in colectia dedicata", async () => {
  const { model, docs } = makeBackupModel();
  const settings = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "updates",
    suggestedCommands: [{ commandName: "x", description: "y", createdBy: "u1", createdAt: new Date() }]
  };

  const record = await saveConfigBackup(model, "guild-1", " Inainte De Test ", "user-1", settings);

  assert.equal(record.name, "inainte-de-test");
  assert.equal(record.snapshot.subscribed, true);
  assert.equal(record.snapshot.notificationChannelId, "updates");
  assert.equal(record.snapshot.suggestedCommands, undefined, "starea operationala nu intra in snapshot");
  assert.equal(docs.length, 1, "backup-ul e un document in colectia guildConfigBackups");
  assert.equal(docs[0].guildId, "guild-1");
  assert.equal(docs[0].name, "inainte-de-test");

  await saveConfigBackup(model, "guild-1", "inainte de test", "user-2", settings);
  assert.equal(docs.length, 1, "acelasi nume normalizat suprascrie backup-ul existent (upsert), nu creeaza duplicat");
  assert.equal(docs[0].createdBy, "user-2");
});

test("saveConfigBackup pastreaza cel mult 20 de backup-uri per guild si evacueaza cele mai vechi (inlocuieste $slice-ul de pe array)", async () => {
  const seeded = Array.from({ length: MAX_CONFIG_BACKUPS }, (_, index) => ({
    guildId: "guild-1",
    name: `backup-${index}`,
    createdBy: "u1",
    createdAt: new Date(Date.UTC(2025, 0, index + 1)),
    snapshot: {}
  }));
  const { model, docs } = makeBackupModel([
    ...seeded,
    { guildId: "guild-2", name: "backup-0", createdBy: "alt", createdAt: new Date(Date.UTC(2020, 0, 1)), snapshot: {} }
  ]);

  await saveConfigBackup(model, "guild-1", "cel-nou", "u2", { _id: "guild-1" });

  const guild1 = docs.filter(doc => doc.guildId === "guild-1");
  assert.equal(guild1.length, MAX_CONFIG_BACKUPS, "capul de 20 per guild e pastrat");
  assert.equal(guild1.some(doc => doc.name === "backup-0"), false, "cel mai vechi backup e evacuat la depasirea capului");
  assert.equal(guild1.some(doc => doc.name === "cel-nou"), true);
  assert.equal(docs.some(doc => doc.guildId === "guild-2"), true, "evictia e per guild, alt guild nu e atins");
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

test("find/list/newest citesc din colectia dedicata cu ordonare descendenta; load restaureaza pe documentul guild", async () => {
  const older = { guildId: "guild-1", name: "old", createdBy: "u1", createdAt: new Date("2024-01-01T00:00:00.000Z"), snapshot: { subscribed: false } };
  const newer = { guildId: "guild-1", name: "new", createdBy: "u2", createdAt: new Date("2025-01-01T00:00:00.000Z"), snapshot: { subscribed: true } };
  const { model } = makeBackupModel([older, newer]);

  assert.equal(normalizeBackupName("  Nume Mare  "), "nume-mare");
  assert.deepEqual(buildConfigSnapshot(null), {});
  assert.equal((await findConfigBackup(model, "guild-1", "NEW"))?.createdBy, "u2", "numele cautat e normalizat");
  assert.deepEqual((await listConfigBackups(model, "guild-1")).map(backup => backup.name), ["new", "old"]);
  assert.equal((await findNewestConfigBackup(model, "guild-1"))?.name, "new");
  assert.equal(await findConfigBackup(model, "guild-2", "new"), null, "alt guild nu vede backup-urile");
  assert.equal(await findNewestConfigBackup(model, "guild-2"), null);

  const restored = await findConfigBackup(model, "guild-1", "new");
  assert.ok(restored);
  const { model: guildModel, calls } = makeGuildModel();
  await loadConfigBackup(guildModel, "guild-1", restored);

  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(calls[0].options, { upsert: true });
  const update = calls[0].update as { $set?: Record<string, unknown>; $unset?: Record<string, string> };
  assert.deepEqual(update.$set, { subscribed: true }, "cheia din snapshot se seteaza");
  assert.equal(update.$unset?.youtubeChannelRoutes, "", "cheile absente din snapshot se curata (restore complet, nu doar $set)");
});

test("deleteConfigBackup sterge pe cheia naturala normalizata si intoarce false pentru nume inexistent", async () => {
  const { model, docs } = makeBackupModel([
    { guildId: "guild-1", name: "prod", createdBy: "u1", createdAt: new Date(), snapshot: {} }
  ]);

  assert.equal(await deleteConfigBackup(model, "guild-1", "lipsa"), false);
  assert.equal(docs.length, 1, "un delete ratat nu sterge nimic");
  assert.equal(await deleteConfigBackup(model, "guild-1", " PROD "), true, "numele e normalizat inainte de stergere");
  assert.equal(docs.length, 0);
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
