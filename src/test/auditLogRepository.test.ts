import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";
import {
  listBotAuditEntries,
  listBotAuditEntriesInRange,
  listServerAuditEntries,
  listServerAuditEntriesInRange,
  recordBotAuditEntry,
  recordServerAuditEntry
} from "../features/admin-records/auditLogRepository";

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

test("auditul e limitat prin push cu $slice si listat descrescator", async () => {
  const { model, calls } = makeGuildModel();

  await recordBotAuditEntry(model, "guild-1", { userId: "u1", command: "/backup add", result: "Access granted." });
  await recordServerAuditEntry(model, "guild-1", { userId: "u1", action: "backup_add", details: "Saved backup prod" });

  assert.match(JSON.stringify(calls[0].update), /botAuditLog/);
  assert.match(JSON.stringify(calls[0].update), /\$slice/, "logul bot e limitat atomic prin $slice");
  assert.match(JSON.stringify(calls[1].update), /serverAuditLog/);
  assert.match(JSON.stringify(calls[1].update), /\$slice/, "logul server e limitat atomic prin $slice");
  assert.deepEqual(calls[0].options, { upsert: true });

  const settings: GuildSettings = {
    _id: "guild-1",
    botAuditLog: [
      { userId: "u1", command: "/old", result: "Access granted.", serverId: "guild-1", at: "2024-01-01T00:00:00.000Z" },
      { userId: "u1", command: "/new", result: "Access denied.", serverId: "guild-1", at: "2025-01-01T00:00:00.000Z" }
    ],
    serverAuditLog: [
      { userId: "u1", action: "old", serverId: "guild-1", at: "2024-01-01T00:00:00.000Z" },
      { userId: "u1", action: "new", serverId: "guild-1", at: "2025-01-01T00:00:00.000Z" }
    ]
  };

  assert.deepEqual(listBotAuditEntries(settings, 1).map(entry => entry.command), ["/new"]);
  assert.deepEqual(listServerAuditEntries(settings, 1).map(entry => entry.action), ["new"]);
});

test("listarile pe interval filtreaza [start, end) si aplica offset + limit dupa sortare descendenta", () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    botAuditLog: [
      { userId: "u1", command: "/in-1", result: "ok", serverId: "guild-1", at: "2025-08-02T00:00:00.000Z" },
      { userId: "u1", command: "/in-2", result: "ok", serverId: "guild-1", at: "2025-08-15T00:00:00.000Z" },
      { userId: "u1", command: "/before", result: "ok", serverId: "guild-1", at: "2025-07-31T23:59:59.000Z" },
      { userId: "u1", command: "/at-end", result: "ok", serverId: "guild-1", at: "2025-09-01T00:00:00.000Z" }
    ],
    serverAuditLog: [
      { userId: "u1", action: "in", serverId: "guild-1", at: "2025-08-10T00:00:00.000Z" },
      { userId: "u1", action: "out", serverId: "guild-1", at: "2025-10-01T00:00:00.000Z" }
    ]
  };
  const start = new Date("2025-08-01T00:00:00.000Z");
  const end = new Date("2025-09-01T00:00:00.000Z");

  assert.deepEqual(
    listBotAuditEntriesInRange(settings, start, end, 25).map(entry => entry.command),
    ["/in-2", "/in-1"],
    "doar intrarile din interval, cele mai noi primele; capatul end e exclusiv"
  );
  assert.deepEqual(
    listBotAuditEntriesInRange(settings, start, end, 1, 1).map(entry => entry.command),
    ["/in-1"],
    "offset-ul sare peste lotul anterior"
  );
  assert.deepEqual(listServerAuditEntriesInRange(settings, start, end, 25).map(entry => entry.action), ["in"]);
});
