import test from "node:test";
import assert from "node:assert/strict";

import {
  listBotAuditEntries,
  listBotAuditEntriesInRange,
  listServerAuditEntries,
  listServerAuditEntriesInRange,
  recordBotAuditEntry,
  recordServerAuditEntry,
  type GuildAuditLogRecord
} from "../features/admin-records/auditLogRepository";

function makeAuditModel(seed: GuildAuditLogRecord[] = []) {
  const docs: GuildAuditLogRecord[] = [...seed];
  const model = {
    create: async (doc: GuildAuditLogRecord) => {
      docs.push(doc);
      return doc;
    },
    find(filter: Record<string, unknown>) {
      let results = docs.filter(doc => doc.guildId === filter.guildId && doc.kind === filter.kind);
      const range = filter.at as { $gte: Date; $lt: Date } | undefined;
      if (range) {
        results = results.filter(doc => {
          const at = new Date(doc.at ?? 0).getTime();
          return at >= range.$gte.getTime() && at < range.$lt.getTime();
        });
      }
      let skipCount = 0;
      let limitCount = results.length;
      const chain = {
        sort(spec: Record<string, 1 | -1>) {
          const direction = spec.at === -1 ? -1 : 1;
          results = [...results].sort((a, b) => direction * (new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime()));
          return chain;
        },
        skip(count: number) {
          skipCount = count;
          return chain;
        },
        limit(count: number) {
          limitCount = count;
          return chain;
        },
        lean: async () => results.slice(skipCount, skipCount + limitCount)
      };
      return chain;
    }
  };
  return { model, docs };
}

test("record* scrie documente separate per kind, cu guildId si at completat", async () => {
  const { model, docs } = makeAuditModel();

  await recordBotAuditEntry(model, "guild-1", { userId: "u1", command: "/backup add", result: "Access granted." });
  await recordServerAuditEntry(model, "guild-1", { userId: "u1", action: "backup_add", details: "Saved backup prod" });

  assert.equal(docs.length, 2);
  assert.equal(docs[0].kind, "bot");
  assert.equal(docs[0].guildId, "guild-1");
  assert.equal(docs[0].command, "/backup add");
  assert.ok(docs[0].at instanceof Date);
  assert.equal(docs[1].kind, "server");
  assert.equal(docs[1].action, "backup_add");
  assert.equal(docs[1].details, "Saved backup prod");
});

test("list* filtreaza pe kind, sorteaza descrescator si mapeaza guildId -> serverId", async () => {
  const { model } = makeAuditModel([
    { guildId: "guild-1", kind: "bot", userId: "u1", command: "/old", result: "Access granted.", at: new Date("2024-01-01T00:00:00.000Z") },
    { guildId: "guild-1", kind: "bot", userId: "u1", command: "/new", result: "Access denied.", at: new Date("2025-01-01T00:00:00.000Z") },
    { guildId: "guild-1", kind: "server", userId: "u1", action: "old", at: new Date("2024-01-01T00:00:00.000Z") },
    { guildId: "guild-1", kind: "server", userId: "u1", action: "new", at: new Date("2025-01-01T00:00:00.000Z") },
    { guildId: "guild-2", kind: "bot", userId: "u2", command: "/alt-guild", result: "ok", at: new Date("2025-06-01T00:00:00.000Z") }
  ]);

  const bot = await listBotAuditEntries(model, "guild-1", 1);
  assert.deepEqual(bot.map(entry => entry.command), ["/new"]);
  assert.equal(bot[0].serverId, "guild-1");

  const server = await listServerAuditEntries(model, "guild-1", 1);
  assert.deepEqual(server.map(entry => entry.action), ["new"]);
});

test("listarile pe interval filtreaza [start, end) si aplica offset + limit dupa sortare descendenta", async () => {
  const { model } = makeAuditModel([
    { guildId: "guild-1", kind: "bot", userId: "u1", command: "/in-1", result: "ok", at: new Date("2025-08-02T00:00:00.000Z") },
    { guildId: "guild-1", kind: "bot", userId: "u1", command: "/in-2", result: "ok", at: new Date("2025-08-15T00:00:00.000Z") },
    { guildId: "guild-1", kind: "bot", userId: "u1", command: "/before", result: "ok", at: new Date("2025-07-31T23:59:59.000Z") },
    { guildId: "guild-1", kind: "bot", userId: "u1", command: "/at-end", result: "ok", at: new Date("2025-09-01T00:00:00.000Z") },
    { guildId: "guild-1", kind: "server", userId: "u1", action: "in", at: new Date("2025-08-10T00:00:00.000Z") },
    { guildId: "guild-1", kind: "server", userId: "u1", action: "out", at: new Date("2025-10-01T00:00:00.000Z") }
  ]);
  const start = new Date("2025-08-01T00:00:00.000Z");
  const end = new Date("2025-09-01T00:00:00.000Z");

  assert.deepEqual(
    (await listBotAuditEntriesInRange(model, "guild-1", start, end, 25)).map(entry => entry.command),
    ["/in-2", "/in-1"],
    "doar intrarile din interval, cele mai noi primele; capatul end e exclusiv"
  );
  assert.deepEqual(
    (await listBotAuditEntriesInRange(model, "guild-1", start, end, 1, 1)).map(entry => entry.command),
    ["/in-1"],
    "offset-ul sare peste lotul anterior"
  );
  assert.deepEqual(
    (await listServerAuditEntriesInRange(model, "guild-1", start, end, 25)).map(entry => entry.action),
    ["in"]
  );
});
