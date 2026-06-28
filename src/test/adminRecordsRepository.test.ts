import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";
import {
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
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].update, { $pull: { configBackups: { name: "inainte-de-test" } } });
  assert.deepEqual(calls[1].options, { upsert: true });
  assert.match(JSON.stringify(calls[1].update), /configBackups/);
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

  assert.deepEqual(calls[0], {
    filter: { _id: "guild-1" },
    update: { $set: { subscribed: true } },
    options: { upsert: true }
  });
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
