import test from "node:test";
import assert from "node:assert/strict";

import { createServerEventLogRuntime } from "../../features/command-security/serverEventLogRuntime.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

function harness() {
  const records: GuildAuditLogRecord[] = [];
  const runtime = createServerEventLogRuntime({
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => { records.push(doc); return doc; },
      find: () => { const q = { sort: () => q, skip: () => q, limit: () => q, lean: async () => [] as GuildAuditLogRecord[] }; return q; }
    }
  });
  return { runtime, records };
}

test("serverEventLogRuntime inregistreaza crearea/stergerea de canale si roluri, cu guildId, actiune si detalii (audit, #9)", async () => {
  const { runtime, records } = harness();

  await runtime.handleChannelCreate({ id: "c1", name: "general", type: 0, guild: { id: "g1" } });
  await runtime.handleChannelDelete({ id: "c1", name: "general", guild: { id: "g1" } });
  await runtime.handleRoleCreate({ id: "r1", name: "Mod", guild: { id: "g1" } });
  await runtime.handleRoleDelete({ id: "r1", name: "Mod", guild: { id: "g1" } });

  assert.deepEqual(records.map(r => r.action), [
    "server-channel-created", "server-channel-deleted", "server-role-created", "server-role-deleted"
  ]);
  assert.ok(records.every(r => r.guildId === "g1" && r.kind === "server"));
  assert.match(records[0].details ?? "", /general \(c1\)/);
  assert.match(records[2].details ?? "", /Mod \(r1\)/);
});

test("serverEventLogRuntime inregistreaza ban add/remove si plecarea membrilor cu userId (audit, #9)", async () => {
  const { runtime, records } = harness();

  await runtime.handleGuildBanAdd({ user: { id: "u9", tag: "spammer" }, guild: { id: "g1" } });
  await runtime.handleGuildBanRemove({ user: { id: "u9", tag: "spammer" }, guild: { id: "g1" } });
  await runtime.handleGuildMemberRemove({ user: { id: "u7", username: "gone" }, guild: { id: "g1" } });

  assert.deepEqual(records.map(r => r.action), ["server-ban-added", "server-ban-removed", "server-member-left"]);
  assert.deepEqual(records.map(r => r.userId), ["u9", "u9", "u7"]);
  assert.match(records[0].details ?? "", /spammer \(u9\)/);
});

test("serverEventLogRuntime ignora evenimentele fara guild si nu arunca daca persistenta esueaza (audit, #9)", async () => {
  const records: GuildAuditLogRecord[] = [];
  const runtime = createServerEventLogRuntime({
    GuildAuditLogModel: {
      create: async () => { throw new Error("mongo down"); },
      find: () => { const q = { sort: () => q, skip: () => q, limit: () => q, lean: async () => [] as GuildAuditLogRecord[] }; return q; }
    },
    logger: () => undefined
  });

  await runtime.handleChannelCreate({ id: "c1", name: "x", guild: null });
  assert.equal(records.length, 0, "eveniment fara guild nu se inregistreaza");
  await assert.doesNotReject(runtime.handleRoleCreate({ id: "r1", name: "y", guild: { id: "g1" } }));
});
