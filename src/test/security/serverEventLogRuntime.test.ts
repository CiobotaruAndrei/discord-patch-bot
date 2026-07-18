import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent } from "discord.js";

import { createServerEventLogRuntime } from "../../features/command-security/serverEventLogRuntime.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

interface FakeAuditEntry {
  id: string;
  executor: { id: string; tag: string };
  target: { id: string; tag: string };
  createdTimestamp: number;
}

function isAuditRecord(value: unknown): value is GuildAuditLogRecord {
  return Boolean(value && typeof value === "object" && "guildId" in value && "kind" in value);
}

function harness(auditEntries: Partial<Record<AuditLogEvent, FakeAuditEntry[]>> = {}) {
  const records: GuildAuditLogRecord[] = [];
  const operationIds = new Set<string>();
  const model = {
    create: async (doc: GuildAuditLogRecord) => { records.push(doc); return doc; },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const operationId = String(filter.operationId ?? "");
      if (operationIds.has(operationId)) return { upsertedCount: 0 };
      operationIds.add(operationId);
      if (isAuditRecord(update.$setOnInsert)) records.push(update.$setOnInsert);
      return { upsertedCount: 1 };
    },
    find: () => {
      const query = { sort: () => query, skip: () => query, limit: () => query, lean: async () => [] as GuildAuditLogRecord[] };
      return query;
    }
  };
  const observeCalls: Array<{ guildId: string; actorId: string; auditEntryId: string; kind: string }> = [];
  const runtime = createServerEventLogRuntime({
    GuildAuditLogModel: model,
    now: () => 100_000,
    sleep: async () => undefined,
    auditRetryDelaysMs: [0],
    memberRemoveDelayMs: 0,
    observeBotAction: async (guildId, actorId, auditEntryId, kind) => { observeCalls.push({ guildId, actorId, auditEntryId, kind }); }
  });
  const guild = {
    id: "g1",
    fetchAuditLogs: async ({ type }: { type: AuditLogEvent; limit: number }) => ({
      entries: {
        find: (predicate: (entry: FakeAuditEntry) => boolean) => (auditEntries[type] ?? []).find(predicate)
      }
    })
  };
  return { runtime, records, guild, observeCalls };
}

function audit(id: string, actorId: string, targetId: string): FakeAuditEntry {
  return {
    id,
    executor: { id: actorId, tag: `actor-${actorId}` },
    target: { id: targetId, tag: `target-${targetId}` },
    createdTimestamp: 99_500
  };
}

test("server log coreleaza actorul pentru canale si roluri si pastreaza tinta separat", async () => {
  const suite = harness({
    [AuditLogEvent.ChannelCreate]: [audit("a1", "mod-1", "c1")],
    [AuditLogEvent.ChannelDelete]: [audit("a2", "mod-1", "c1")],
    [AuditLogEvent.RoleCreate]: [audit("a3", "mod-2", "r1")],
    [AuditLogEvent.RoleDelete]: [audit("a4", "mod-2", "r1")]
  });

  await suite.runtime.handleChannelCreate({ id: "c1", name: "general", type: 0, guild: suite.guild });
  await suite.runtime.handleChannelDelete({ id: "c1", name: "general", guild: suite.guild });
  await suite.runtime.handleRoleCreate({ id: "r1", name: "Mod", guild: suite.guild });
  await suite.runtime.handleRoleDelete({ id: "r1", name: "Mod", guild: suite.guild });

  assert.deepEqual(suite.records.map(record => record.action), [
    "server-channel-created", "server-channel-deleted", "server-role-created", "server-role-deleted"
  ]);
  assert.deepEqual(suite.records.map(record => record.actorId), ["mod-1", "mod-1", "mod-2", "mod-2"]);
  assert.deepEqual(suite.records.map(record => record.targetId), ["c1", "c1", "r1", "r1"]);
});

test("ban si unban afiseaza moderatorul ca actor si membrul sanctionat ca tinta", async () => {
  const suite = harness({
    [AuditLogEvent.MemberBanAdd]: [audit("ban-1", "mod-1", "u9")],
    [AuditLogEvent.MemberBanRemove]: [audit("unban-1", "mod-2", "u9")]
  });

  await suite.runtime.handleGuildBanAdd({ user: { id: "u9", tag: "spammer" }, guild: suite.guild });
  await suite.runtime.handleGuildBanRemove({ user: { id: "u9", tag: "spammer" }, guild: suite.guild });

  assert.deepEqual(suite.records.map(record => record.actorId), ["mod-1", "mod-2"]);
  assert.deepEqual(suite.records.map(record => record.targetId), ["u9", "u9"]);
  assert.deepEqual(suite.records.map(record => record.action), ["server-ban-added", "server-ban-removed"]);
});

test("member remove distinge kick-ul de plecarea voluntara si logheaza join-ul", async () => {
  const kicked = harness({ [AuditLogEvent.MemberKick]: [audit("kick-1", "mod-3", "u7")] });
  await kicked.runtime.handleGuildMemberRemove({ user: { id: "u7", tag: "removed" }, guild: kicked.guild });
  assert.equal(kicked.records[0].action, "server-member-kicked");
  assert.equal(kicked.records[0].actorId, "mod-3");

  const voluntary = harness();
  await voluntary.runtime.handleGuildMemberAdd({ user: { id: "u8", tag: "new" }, guild: voluntary.guild });
  await voluntary.runtime.handleGuildMemberRemove({ user: { id: "u8", tag: "new" }, guild: voluntary.guild });
  assert.deepEqual(voluntary.records.map(record => record.action), ["server-member-joined", "server-member-left"]);
  assert.equal(voluntary.records[1].actorId, "");
  assert.equal(voluntary.records[1].targetId, "u8");
});

test("banul gateway si member remove corelat produc o singura intrare", async () => {
  const suite = harness({ [AuditLogEvent.MemberBanAdd]: [audit("ban-shared", "mod-1", "u9")] });
  const ban = { user: { id: "u9", tag: "spammer" }, guild: suite.guild };
  await suite.runtime.handleGuildBanAdd(ban);
  await suite.runtime.handleGuildMemberRemove(ban);
  assert.equal(suite.records.length, 1);
  assert.equal(suite.records[0].action, "server-ban-added");
});

test("actorul ramane explicit necunoscut cand Audit Log este indisponibil", async () => {
  const suite = harness();
  const unavailableGuild = { id: "g1", fetchAuditLogs: async () => { throw new Error("forbidden"); } };
  await suite.runtime.handleGuildBanAdd({ user: { id: "u9", tag: "spammer" }, guild: unavailableGuild });
  assert.equal(suite.records[0].actorId, "");
  assert.equal(suite.records[0].targetId, "u9");
  assert.match(suite.records[0].details ?? "", /actor=necunoscut/);
});

test("evenimentele de canal/ban/kick alimenteaza contextul de observatie a botului, cheiate pe audit entry ID (audit, #6)", async () => {
  const suite = harness({
    [AuditLogEvent.ChannelCreate]: [audit("a1", "bot-1", "c1")],
    [AuditLogEvent.MemberBanAdd]: [audit("a2", "bot-1", "u1")]
  });
  await suite.runtime.handleChannelCreate({ id: "c1", name: "spam", type: 0, guild: suite.guild });
  await suite.runtime.handleGuildBanAdd({ user: { id: "u1", tag: "victima" }, guild: suite.guild });
  assert.deepEqual(suite.observeCalls, [
    { guildId: "g1", actorId: "bot-1", auditEntryId: "a1", kind: "server-channel-created" },
    { guildId: "g1", actorId: "bot-1", auditEntryId: "a2", kind: "server-ban-added" }
  ]);
});

test("un eveniment fara actor din Audit Log NU alimenteaza contextul de observatie (audit, #6)", async () => {
  const suite = harness();
  await suite.runtime.handleGuildMemberAdd({ user: { id: "u9", tag: "nou" }, guild: suite.guild });
  assert.equal(suite.observeCalls.length, 0, "member-joined nu are actor/audit, deci nu se coreleaza cu vreun bot");
});

test("un timeout nou aplicat de un actor este inregistrat si alimenteaza observatia (audit, #6)", async () => {
  const suite = harness({
    [AuditLogEvent.MemberUpdate]: [audit("a7", "bot-1", "u1")]
  });
  const previous = { user: { id: "u1", tag: "victima" }, communicationDisabledUntil: null, guild: suite.guild };
  const next = { user: { id: "u1", tag: "victima" }, communicationDisabledUntil: new Date(100_000 + 600_000), guild: suite.guild };
  await suite.runtime.handleGuildMemberTimeout(previous, next);
  assert.deepEqual(suite.observeCalls, [
    { guildId: "g1", actorId: "bot-1", auditEntryId: "a7", kind: "server-member-timeout" }
  ]);
});

test("o actualizare de membru fara timeout nou NU produce eveniment (audit, #6)", async () => {
  const suite = harness({ [AuditLogEvent.MemberUpdate]: [audit("a8", "bot-1", "u1")] });
  const expired = { user: { id: "u1" }, communicationDisabledUntil: new Date(100_000 - 1000), guild: suite.guild };
  await suite.runtime.handleGuildMemberTimeout(expired, expired);
  assert.equal(suite.observeCalls.length, 0, "un timeout expirat/neschimbat nu e o actiune noua");
});
