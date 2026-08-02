import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

import { createPermissionDelegationRuntime } from "../../features/command-security/permissionDelegationRuntime.js";
import { AuditLogEvent } from "discord.js";
import { createModerationGuardGate } from "../../features/command-security/moderationGuardGate.js";
import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { isSubscriptionStartStop } from "../../features/command-handlers/subscriptionNotificationHandlers.js";
import { START_STOP_TOGGLE_FIELDS } from "../../features/command-security/securityCommandFields.js";
import { moduleContext } from "../moduleContextStub.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";
import type { GuardedDelegationGate } from "../../features/command-security/permissionDelegationContext.js";

const NOW = Date.parse("2026-08-01T10:00:00.000Z");

function permissions(...values: bigint[]) {
  const set = new Set(values);
  return { has: (value: bigint) => set.has(value), bitfield: values.reduce((mask, value) => mask | value, 0n) };
}

function auditModel(records: GuildAuditLogRecord[]) {
  return {
    create: async (record: GuildAuditLogRecord) => { records.push(record); return record; },
    find: () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] })
  };
}

function roleUpdateScenario(guard: GuardedDelegationGate | undefined) {
  const reverts: bigint[] = [];
  const audits: GuildAuditLogRecord[] = [];
  const guild = {
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["e", {
        id: "audit-1",
        executor: { id: "mod-1" },
        target: { id: "role-1" },
        createdTimestamp: NOW,
        changes: [{ key: "permissions", old: "0", new: String(PermissionFlagsBits.BanMembers) }]
      }]])
    })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildModel: { findOne: async () => null, findOneAndUpdate: async () => null, updateOne: async () => ({ modifiedCount: 1 }) },
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async () => undefined,
    now: () => NOW,
    wait: async () => undefined,
    guard
  });
  const previous = { id: "role-1", name: "Moderator", guild, permissions: permissions() };
  const next = {
    id: "role-1",
    name: "Moderator",
    guild,
    permissions: permissions(PermissionFlagsBits.BanMembers),
    setPermissions: async (bits: bigint) => { reverts.push(bits); return undefined; }
  };
  return { runtime, previous, next, reverts, audits };
}

test("fara poarta de aprobare configurata, comportamentul de dinainte ramane neschimbat", async () => {
  const scenario = roleUpdateScenario(undefined);

  await scenario.runtime.handleRoleUpdate(scenario.previous, scenario.next);

  assert.equal(scenario.reverts.length, 1, "compatibilitate: serverele fara moderation-guard pastreaza retragerea automata");
});

test("cu moderation-guard oprit, permisiunea acordata nu mai este retrasa automat", async () => {
  const gate = createModerationGuardGate({
    PermissionRequestModel: permissionRequestStore(),
    readGuildSettings: async () => ({ moderationGuardEnabled: false })
  });
  const scenario = roleUpdateScenario(gate);

  await scenario.runtime.handleRoleUpdate(scenario.previous, scenario.next);

  assert.equal(scenario.reverts.length, 0, "specificatia cere ca retragerea sa nu mai fie un mecanism permanent independent");
  assert.equal(scenario.audits.length, 0);
});

test("cu moderation-guard pornit si fara aprobare, permisiunea este retrasa", async () => {
  const gate = createModerationGuardGate({
    PermissionRequestModel: permissionRequestStore(),
    readGuildSettings: async () => ({ moderationGuardEnabled: true })
  });
  const scenario = roleUpdateScenario(gate);

  await scenario.runtime.handleRoleUpdate(scenario.previous, scenario.next);

  assert.equal(scenario.reverts.length, 1);
  assert.equal(scenario.reverts[0] & PermissionFlagsBits.BanMembers, 0n, "permisiunea sensibila dispare, restul bitilor raman");
  assert.equal(scenario.audits.at(-1)?.action, "protected-role-permissions-reverted");
});

test("cu moderation-guard pornit si aprobare exacta, permisiunea ramane si aprobarea se consuma", async () => {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "permission-grant", requesterId: "mod-1",
    target: "role-1", action: "grant", permissions: ["BanMembers"], reason: "escaladare temporara"
  });
  await repository.resolve("g1", "req-1", "approved", "owner-1", { target: "role-1", action: "grant", permissions: ["BanMembers"] });

  const scenario = roleUpdateScenario(createModerationGuardGate({
    PermissionRequestModel: model,
    readGuildSettings: async () => ({ moderationGuardEnabled: true })
  }));

  await scenario.runtime.handleRoleUpdate(scenario.previous, scenario.next);

  assert.equal(scenario.reverts.length, 0, "o aprobare exacta a ownerului lasa modificarea sa treaca");
  assert.equal(model.records[0].status, "used", "aprobarea este de unica folosinta");
});

test("aprobarea consumata o data nu mai acopera o a doua acordare", async () => {
  let consumed = 0;
  const gate: GuardedDelegationGate = {
    readSituation: async () => ({ guardEnabled: true, raidConfirmed: false }),
    consumeApproval: async () => (consumed++ === 0 ? { _id: "req-1" } : null)
  };
  const first = roleUpdateScenario(gate);
  await first.runtime.handleRoleUpdate(first.previous, first.next);
  const second = roleUpdateScenario(gate);
  await second.runtime.handleRoleUpdate(second.previous, second.next);

  assert.equal(first.reverts.length, 0);
  assert.equal(second.reverts.length, 1, "a doua acordare nu se poate ascunde in spatele aceleiasi aprobari");
});

test("in timpul unui raid confirmat, retragerea automata nu se mai suprapune peste anti-raid", async () => {
  const gate = createModerationGuardGate({
    PermissionRequestModel: permissionRequestStore(),
    readGuildSettings: async () => ({ moderationGuardEnabled: true }),
    isRaidConfirmed: async () => true
  });
  const scenario = roleUpdateScenario(gate);

  await scenario.runtime.handleRoleUpdate(scenario.previous, scenario.next);

  assert.equal(scenario.reverts.length, 0);
});

test("/stop moderation-guard anuleaza aprobarile ramase inainte sa stinga poarta", async () => {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({ requestId: "a", guildId: "g1", type: "webhook", requesterId: "u1", target: "c", action: "create", reason: "x" });
  await repository.create({ requestId: "b", guildId: "g1", type: "permission-grant", requesterId: "u2", target: "r", action: "grant", reason: "y" });
  await repository.resolve("g1", "b", "approved", "owner-1");
  await repository.create({ requestId: "c", guildId: "g2", type: "webhook", requesterId: "u3", target: "c", action: "create", reason: "z" });

  assert.equal(await repository.countActive("g1"), 2);
  await repository.cancelTypes("g1", MODERATION_GUARD_TYPES);

  assert.deepEqual(model.records.map(record => record.status), ["cancelled", "cancelled", "pending"]);
  assert.equal(await repository.countActive("g1"), 0, "dupa oprire nu mai ramane nicio aprobare care sa poata fi consumata mai tarziu");
  assert.equal(await repository.countActive("g2"), 1, "oprirea pe un server nu atinge alt server");
});

test("orice protectie din START_STOP_TOGGLE_FIELDS este exclusa automat din handlerul de abonamente", () => {
  const subcommands = Object.keys(START_STOP_TOGGLE_FIELDS);
  assert.ok(subcommands.includes("moderation-guard"));
  for (const subcommand of subcommands) {
    const claimed = isSubscriptionStartStop(moduleContext<Parameters<typeof isSubscriptionStartStop>[0]>({
      isChatInputCommand: () => true,
      guild: { id: "g1" },
      commandName: "start",
      options: { getSubcommand: () => subcommand }
    }));
    assert.equal(claimed, false, `${subcommand} apartine handlerului de securitate, nu celui de abonamente`);
  }
  assert.equal(isSubscriptionStartStop(moduleContext<Parameters<typeof isSubscriptionStartStop>[0]>({
    isChatInputCommand: () => true,
    guild: { id: "g1" },
    commandName: "start",
    options: { getSubcommand: () => "updates" }
  })), true, "abonamentele obisnuite raman la handlerul lor");
});

function channelOverwriteScenario(guard: GuardedDelegationGate | undefined) {
  const edits: Array<{ targetId: string; patch: Record<string, boolean | null> }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const guild = {
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async (options: { type: AuditLogEvent }) => ({
      entries: options.type === AuditLogEvent.ChannelOverwriteUpdate || options.type === AuditLogEvent.ChannelOverwriteCreate
        ? new Map([["e", { id: "audit-2", target: { id: "channel-1" }, executor: { id: "mod-1" }, createdTimestamp: NOW }]])
        : new Map()
    })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildModel: { findOne: async () => null, findOneAndUpdate: async () => null, updateOne: async () => ({ modifiedCount: 1 }) },
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async () => undefined,
    now: () => NOW,
    wait: async () => undefined,
    guard
  });
  const previous = {
    id: "channel-1",
    guild,
    permissionOverwrites: { cache: new Map([["role-x", { id: "role-x", allow: permissions(), deny: permissions() }]]) }
  };
  const next = {
    id: "channel-1",
    name: "anunturi",
    guild,
    permissionOverwrites: {
      cache: new Map([["role-x", { id: "role-x", allow: permissions(PermissionFlagsBits.ManageWebhooks), deny: permissions() }]]),
      edit: async (targetId: string, patch: Record<string, boolean | null>) => { edits.push({ targetId, patch }); return undefined; }
    }
  };
  return { runtime, previous, next, edits, audits };
}

test("cu moderation-guard oprit, un overwrite de canal cu Manage Webhooks nu mai este retras automat (audit, F-15)", async () => {
  const gate = createModerationGuardGate({
    PermissionRequestModel: permissionRequestStore(),
    readGuildSettings: async () => ({ moderationGuardEnabled: false })
  });
  const scenario = channelOverwriteScenario(gate);

  await scenario.runtime.handleChannelUpdate(scenario.previous, scenario.next);

  assert.deepEqual(scenario.edits, [], "retragerea permanenta a disparut: fara poarta activa nu se modifica nimic");
});

test("cu moderation-guard pornit si fara aprobare, overwrite-ul de canal este retras", async () => {
  const gate = createModerationGuardGate({
    PermissionRequestModel: permissionRequestStore(),
    readGuildSettings: async () => ({ moderationGuardEnabled: true })
  });
  const scenario = channelOverwriteScenario(gate);

  await scenario.runtime.handleChannelUpdate(scenario.previous, scenario.next);

  assert.equal(scenario.edits.length, 1);
  assert.equal(scenario.edits[0].patch.ManageWebhooks, null);
});

test("cu moderation-guard pornit si aprobare exacta, overwrite-ul de canal ramane", async () => {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-ov", guildId: "g1", type: "permission-grant", requesterId: "mod-1",
    target: "channel-1", action: "grant", permissions: ["Manage Webhooks"], reason: "integrare"
  });
  await repository.resolve("g1", "req-ov", "approved", "owner-1", { target: "channel-1", action: "grant", permissions: ["Manage Webhooks"] });

  const scenario = channelOverwriteScenario(createModerationGuardGate({
    PermissionRequestModel: model,
    readGuildSettings: async () => ({ moderationGuardEnabled: true })
  }));

  await scenario.runtime.handleChannelUpdate(scenario.previous, scenario.next);

  assert.deepEqual(scenario.edits, [], "o aprobare exacta acopera si overwrite-urile de canal");
  assert.equal(model.records[0].status, "used");
});

test("in timpul unui raid confirmat, overwrite-urile de canal nu se suprapun peste anti-raid", async () => {
  const gate = createModerationGuardGate({
    PermissionRequestModel: permissionRequestStore(),
    readGuildSettings: async () => ({ moderationGuardEnabled: true }),
    isRaidConfirmed: async () => true
  });
  const scenario = channelOverwriteScenario(gate);

  await scenario.runtime.handleChannelUpdate(scenario.previous, scenario.next);

  assert.deepEqual(scenario.edits, []);
});
