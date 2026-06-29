import test from "node:test";
import assert from "node:assert/strict";

import type { FutureReleaseGameEntry, GuildSettings } from "../types";
import {
  buildConfigRestoreUpdate,
  buildConfigSnapshot,
  findBackup,
  listBackups,
  listBotAuditEntries,
  listServerAuditEntries,
  listSuggestedCommands,
  loadConfigBackup,
  normalizeBackupName,
  recordBotAuditEntry,
  recordServerAuditEntry,
  saveConfigBackup,
  saveFutureReleaseGame,
  saveSuggestedCommand
} from "../features/admin-records/adminRecordsRepository";

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

test("admin records: backup-ul normalizeaza numele si copiaza doar configuratia botului", async () => {
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
  assert.equal(calls.length, 1, "salvarea e o singura operatie atomica (pipeline), nu $pull + $push separate (R[P3] #5)");
  assert.deepEqual(calls[0].options, { upsert: true });
  const serialized = JSON.stringify(calls[0].update);
  assert.match(serialized, /configBackups/);
  assert.match(serialized, /inainte-de-test/);
  assert.match(serialized, /\$slice/, "pipeline-ul filtreaza acelasi nume si limiteaza prin $slice intr-un singur update");
});

test("admin records: load si listarile folosesc snapshot-uri si ordonare descendenta", async () => {
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

test("admin records: auditul si sugestiile sunt limitate prin push slice si listate descrescator", async () => {
  const { model, calls } = makeGuildModel();

  await recordBotAuditEntry(model, "guild-1", { userId: "u1", command: "/backup add", result: "Access granted." });
  await recordServerAuditEntry(model, "guild-1", { userId: "u1", action: "backup_add", details: "Saved backup prod" });
  await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "arata calendar", createdBy: "u2" });

  assert.match(JSON.stringify(calls[0].update), /botAuditLog/);
  assert.match(JSON.stringify(calls[1].update), /serverAuditLog/);
  assert.match(JSON.stringify(calls[2].update), /suggestedCommands/);

  const settings: GuildSettings = {
    _id: "guild-1",
    botAuditLog: [
      { userId: "u1", command: "/old", result: "Access granted.", serverId: "guild-1", at: "2024-01-01T00:00:00.000Z" },
      { userId: "u1", command: "/new", result: "Access denied.", serverId: "guild-1", at: "2025-01-01T00:00:00.000Z" }
    ],
    serverAuditLog: [
      { userId: "u1", action: "old", serverId: "guild-1", at: "2024-01-01T00:00:00.000Z" },
      { userId: "u1", action: "new", serverId: "guild-1", at: "2025-01-01T00:00:00.000Z" }
    ],
    suggestedCommands: [
      { commandName: "old", description: "old", createdBy: "u1", createdAt: "2024-01-01T00:00:00.000Z" },
      { commandName: "new", description: "new", createdBy: "u2", createdAt: "2025-01-01T00:00:00.000Z" }
    ]
  };

  assert.deepEqual(listBotAuditEntries(settings, 1).map(entry => entry.command), ["/new"]);
  assert.deepEqual(listServerAuditEntries(settings, 1).map(entry => entry.action), ["new"]);
  assert.deepEqual(listSuggestedCommands(settings, 1).map(entry => entry.commandName), ["new"]);
});

test("buildConfigRestoreUpdate face $unset pentru cheile lipsa din snapshot, nu doar $set (R[P1] restore complet)", () => {
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

test("loadConfigBackup aplica $set + $unset intr-un singur updateOne", async () => {
  const calls: Array<{ update: Record<string, unknown> }> = [];
  const GuildModel = { updateOne: async (_f: Record<string, unknown>, update: Record<string, unknown>) => { calls.push({ update }); return { modifiedCount: 1 }; } };
  await loadConfigBackup(GuildModel, "guild-1", { name: "v", createdBy: "", createdAt: new Date(), snapshot: { subscribed: false } });
  assert.equal(calls.length, 1);
  assert.ok((calls[0].update as { $unset?: unknown }).$unset, "restore-ul cere $unset, deci sterge setarile absente din backup");
});

function futureReleaseModel(existing: FutureReleaseGameEntry[]) {
  const calls: Array<{ update: unknown; options?: unknown }> = [];
  return {
    calls,
    updateOne: async (_filter: Record<string, unknown>, _update: unknown, _options?: Record<string, unknown>) => {
      throw new Error("saveFutureReleaseGame nu trebuie sa foloseasca updateOne");
    },
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: unknown, options?: Record<string, unknown>): Promise<{ futureReleaseGames?: FutureReleaseGameEntry[] } | null> => {
      calls.push({ update, options });
      const stage = (update as Array<{ $set?: { futureReleaseGames?: { $let?: { in?: { $cond?: unknown[] } } } } }>)[0];
      const cond = stage.$set?.futureReleaseGames?.$let?.in?.$cond as Array<{ $concatArrays?: unknown[] }>;
      const record = (cond[1].$concatArrays?.[1] as FutureReleaseGameEntry[])[0];
      const kept = existing.filter(game => game.gameName !== record.gameName);
      const futureReleaseGames = kept.length < 20 ? [...kept, record] : kept;
      return { futureReleaseGames };
    }
  };
}

test("saveFutureReleaseGame salveaza atomic printr-un singur findOneAndUpdate cu pipeline", async () => {
  const model = futureReleaseModel([]);
  const result = await saveFutureReleaseGame(model, "guild-1", { gameName: "silksong", releaseDate: "", preorderPrice: "", addedBy: "admin" });
  assert.equal(result.saved, true);
  assert.equal(model.calls.length, 1, "o singura operatie atomica, nu pull+push separat");
  assert.ok(Array.isArray(model.calls[0].update), "update-ul e un aggregation pipeline");
  assert.deepEqual(model.calls[0].options, { upsert: true, new: true });
});

test("saveFutureReleaseGame refuza al 21-lea joc nou fara sa evacueze tacut alt entry", async () => {
  const full = Array.from({ length: 20 }, (_value, index) => ({ gameName: `game-${index}`, addedBy: "admin", addedAt: new Date() }));
  const model = futureReleaseModel(full);
  const result = await saveFutureReleaseGame(model, "guild-1", { gameName: "silksong", releaseDate: "", preorderPrice: "", addedBy: "admin" });
  assert.equal(result.saved, false, "lista plina => add refuzat atomic (concurenta nu poate depasi limita)");
});
