import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";

import { createPermissionDelegationRuntime } from "../../features/command-security/permissionDelegationRuntime.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

function permissions(...values: bigint[]) {
  const set = new Set(values);
  return { has: (value: bigint) => set.has(value) };
}

function auditModel(records: GuildAuditLogRecord[]) {
  return {
    create: async (record: GuildAuditLogRecord) => {
      records.push(record);
      return record;
    },
    find: () => ({
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean: async () => []
    })
  };
}

test("permisiunile sensibile acordate de altcineva decat owner sunt restaurate", async () => {
  const restored: Array<{ reason?: string }> = [];
  const alerts: string[] = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async (options: { type: AuditLogEvent }) => {
      assert.equal(options.type, AuditLogEvent.RoleUpdate);
      return {
        entries: new Map([["entry", {
          target: { id: "role-1" },
          executor: { id: "admin-2" },
          createdTimestamp: now
        }]])
      };
    }
  };
  const previous = { id: "role-1", name: "Helper", permissions: permissions(), guild };
  const next = {
    id: "role-1",
    name: "Helper",
    permissions: permissions(PermissionFlagsBits.Administrator),
    guild,
    setPermissions: async (_value: ReturnType<typeof permissions>, reason?: string) => {
      restored.push({ reason });
    }
  };
  const metrics = { permissionDelegationsReverted: 0 };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async (_kind, _title, body) => { alerts.push(body); },
    metrics,
    now: () => now
  });

  await runtime.handleRoleUpdate(previous, next);

  assert.equal(restored.length, 1);
  assert.match(restored[0].reason ?? "", /numai ownerul/);
  assert.equal(metrics.permissionDelegationsReverted, 1);
  assert.equal(audits[0].action, "protected-role-permissions-reverted");
  assert.match(alerts[0], /admin-2/);
});

test("ownerul poate acorda permisiuni sensibile fara rollback", async () => {
  let restored = false;
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["entry", {
        target: { id: "role-1" },
        executor: { id: "owner-1" },
        createdTimestamp: now
      }]])
    })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel([]),
    adminAlert: async () => undefined,
    now: () => now
  });

  await runtime.handleRoleUpdate(
    { id: "role-1", permissions: permissions(), guild },
    {
      id: "role-1",
      permissions: permissions(PermissionFlagsBits.BanMembers),
      guild,
      setPermissions: async () => { restored = true; }
    }
  );

  assert.equal(restored, false);
});

test("rolul sensibil atribuit de un non-owner este eliminat de pe membru", async () => {
  const removed: string[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["entry", {
        target: { id: "member-1" },
        executor: { id: "admin-2" },
        createdTimestamp: now
      }]])
    })
  };
  const protectedRole = {
    id: "role-1",
    name: "Delegated Admin",
    permissions: permissions(PermissionFlagsBits.ManageWebhooks),
    guild
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel([]),
    adminAlert: async () => undefined,
    now: () => now
  });

  await runtime.handleGuildMemberUpdate(
    {
      id: "member-1",
      guild,
      roles: { cache: new Map() }
    },
    {
      id: "member-1",
      guild,
      roles: {
        cache: new Map([["role-1", protectedRole]]),
        remove: async roleId => {
          removed.push(roleId);
        }
      }
    }
  );

  assert.deepEqual(removed, ["role-1"]);
});
