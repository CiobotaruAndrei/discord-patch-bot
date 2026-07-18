import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";

import { createPermissionDelegationRuntime } from "../../features/command-security/permissionDelegationRuntime.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

function permissions(...values: bigint[]) {
  const set = new Set(values);
  return {
    has: (value: bigint) => set.has(value),
    bitfield: values.reduce((mask, value) => mask | value, 0n)
  };
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

test("webhookUpdate atribuit precis unui bot observat este persistat si alertat o singura data", async () => {
  const audits: GuildAuditLogRecord[] = [];
  const alerts: string[] = [];
  const now = Date.parse("2026-07-18T12:00:00.000Z");
  const observation = {
    botId: "bot-1",
    requesterId: "user-1",
    approval: "one-time",
    initialRisk: "normal",
    joinedAt: new Date(now - 1000),
    observeUntil: new Date(now + 86_400_000),
    lastActivityAt: new Date(now),
    eventKeys: ["audit:webhook-1"],
    recentEvents: [{ key: "audit:webhook-1", kind: "webhook-change", at: new Date(now), confirmed: true }],
    lastBurstAlertAt: null
  };
  const GuildModel = {
    findOne: async () => ({ botObservations: [observation] }),
    findOneAndUpdate: async () => null,
    updateOne: async () => ({ modifiedCount: 1 })
  };
  const guild = {
    id: "guild-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["entry", {
        id: "webhook-1",
        executor: { id: "bot-1" },
        target: { id: "webhook-target" },
        extra: { channel: { id: "channel-1" } },
        createdTimestamp: now
      }]])
    })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildModel,
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async (_kind, _title, body) => { alerts.push(body); },
    now: () => now,
    wait: async () => undefined
  });

  await runtime.handleWebhookUpdate({ id: "channel-1", guild });

  assert.equal(audits.at(-1)?.action, "observed-bot-webhook-change");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /atribuita precis/);
});

test("restaurarea la roleUpdate elimina DOAR permisiunile protejate adaugate; schimbarile legitime din acelasi update raman (raport post-#705, #4)", async () => {
  const restored: Array<{ value: bigint; reason?: string }> = [];
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
    permissions: permissions(PermissionFlagsBits.Administrator, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles),
    guild,
    setPermissions: async (value: bigint, reason?: string) => {
      restored.push({ value, reason });
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
  assert.equal(
    restored[0].value,
    PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles,
    "setul final porneste de la permisiunile NOI si elimina doar Administrator; Send Messages si Attach Files raman"
  );
  assert.match(restored[0].reason ?? "", /numai ownerul/);
  assert.equal(metrics.permissionDelegationsReverted, 1);
  assert.equal(audits[0].action, "protected-role-permissions-reverted");
  assert.match(audits[0].details ?? "", /removed=Administrator/);
  assert.match(alerts[0], /admin-2/);
  assert.match(alerts[0], /restul modificarilor raman/);
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

test("un rol NOU creat cu permisiuni sensibile de un non-owner pierde DOAR cele 5 permisiuni protejate; restul raman (raport post-#705, #5)", async () => {
  const cleared: Array<{ value: bigint; reason?: string }> = [];
  const alerts: string[] = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async (options: { type: AuditLogEvent }) => {
      assert.equal(options.type, AuditLogEvent.RoleCreate);
      return {
        entries: new Map([["entry", {
          target: { id: "role-new" },
          executor: { id: "admin-2" },
          createdTimestamp: now
        }]])
      };
    }
  };
  const metrics = { permissionDelegationsReverted: 0 };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async (_kind, _title, body) => { alerts.push(body); },
    metrics,
    now: () => now
  });

  await runtime.handleRoleCreate({
    id: "role-new",
    name: "Sneaky Admin",
    permissions: permissions(PermissionFlagsBits.Administrator, PermissionFlagsBits.BanMembers, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks),
    guild,
    setPermissions: async (value: bigint, reason?: string) => { cleared.push({ value, reason }); }
  });

  assert.equal(cleared.length, 1);
  assert.equal(
    cleared[0].value,
    PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks,
    "doar Administrator si Ban Members sunt eliminate; permisiunile normale raman pe rolul nou"
  );
  assert.match(cleared[0].reason ?? "", /numai ownerul/);
  assert.equal(metrics.permissionDelegationsReverted, 1);
  assert.equal(audits[0].action, "protected-role-create-reverted");
  assert.match(audits[0].details ?? "", /removed=Administrator\+Ban Members/);
  assert.match(alerts[0], /admin-2/);
  assert.match(alerts[0], /permisiunile neprotejate raman/);
});

test("roleCreate: ownerul poate crea roluri sensibile; rolurile gestionate de integrari doar alerteaza", async () => {
  let cleared = 0;
  const alerts: string[] = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guildWithActor = (executorId: string) => ({
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["entry", {
        target: { id: "role-new" },
        executor: { id: executorId },
        createdTimestamp: now
      }]])
    })
  });
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async (_kind, _title, body) => { alerts.push(body); },
    now: () => now
  });

  await runtime.handleRoleCreate({
    id: "role-new",
    permissions: permissions(PermissionFlagsBits.BanMembers),
    guild: guildWithActor("owner-1"),
    setPermissions: async () => { cleared++; }
  });
  assert.equal(cleared, 0, "rolul creat de owner ramane neatins");

  await runtime.handleRoleCreate({
    id: "role-new",
    name: "Integration Bot",
    managed: true,
    permissions: permissions(PermissionFlagsBits.ManageWebhooks),
    guild: guildWithActor("admin-2"),
    setPermissions: async () => { cleared++; }
  });
  assert.equal(cleared, 0, "rolul gestionat de integrare NU e golit automat");
  assert.equal(audits[0].action, "protected-managed-role-created-alerted");
  assert.match(alerts[0], /gestionat de integrare/);
  assert.match(alerts[0], /verificare owner necesara/);
});

test("channelUpdate: un overwrite care acorda Manage Webhooks e restaurat la starea anterioara", async () => {
  const edits: Array<{ targetId: string; permissions: Record<string, boolean | null>; reason?: string }> = [];
  const alerts: string[] = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async (options: { type: AuditLogEvent }) => {
      assert.ok(
        options.type === AuditLogEvent.ChannelOverwriteUpdate || options.type === AuditLogEvent.ChannelOverwriteCreate,
        "actorul e cautat in evenimentele de overwrite"
      );
      return {
        entries: new Map([["entry", {
          target: { id: "channel-1" },
          executor: { id: "admin-2" },
          createdTimestamp: now
        }]])
      };
    }
  };
  const metrics = { permissionDelegationsReverted: 0 };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async (_kind, _title, body) => { alerts.push(body); },
    metrics,
    now: () => now
  });

  await runtime.handleChannelUpdate(
    {
      id: "channel-1",
      guild,
      permissionOverwrites: {
        cache: new Map([["role-x", { id: "role-x", allow: permissions(), deny: permissions(PermissionFlagsBits.ManageWebhooks) }]])
      }
    },
    {
      id: "channel-1",
      name: "general",
      guild,
      permissionOverwrites: {
        cache: new Map([
          ["role-x", { id: "role-x", allow: permissions(PermissionFlagsBits.ManageWebhooks), deny: permissions() }],
          ["role-y", { id: "role-y", allow: permissions(PermissionFlagsBits.ManageRoles), deny: permissions() }]
        ]),
        edit: async (targetId: string, perms: Record<string, boolean | null>, options?: { reason?: string }) => {
          edits.push({ targetId, permissions: perms, reason: options?.reason });
        }
      }
    }
  );

  assert.equal(edits.length, 1, "doar overwrite-ul cu o permisiune din cele 5 protejate (Manage Webhooks) e restaurat; Manage Roles NU e protejat (raport post-#705, #7)");
  assert.deepEqual(edits[0], {
    targetId: "role-x",
    permissions: { ManageWebhooks: false },
    reason: "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile prin overwrite de canal"
  }, "starea anterioara era deny => se restaureaza deny");
  assert.ok(!edits.some(edit => edit.targetId === "role-y"), "overwrite-ul de Manage Roles ramane neatins - nu face parte din cele 5 permisiuni protejate");
  assert.equal(metrics.permissionDelegationsReverted, 1);
  assert.equal(audits[0].action, "protected-channel-overwrite-reverted");
  assert.match(audits[0].details ?? "", /role-x:ManageWebhooks/);
  assert.doesNotMatch(audits[0].details ?? "", /ManageRoles/);
  assert.match(alerts[0], /admin-2/);
});

test("channelUpdate: overwrite-urile schimbate de owner raman; fara permisiuni sensibile noi nu se cauta actorul", async () => {
  let edited = 0;
  let auditLookups = 0;
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => {
      auditLookups++;
      return {
        entries: new Map([["entry", {
          target: { id: "channel-1" },
          executor: { id: "owner-1" },
          createdTimestamp: now
        }]])
      };
    }
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel([]),
    adminAlert: async () => undefined,
    now: () => now
  });

  await runtime.handleChannelUpdate(
    { id: "channel-1", guild, permissionOverwrites: { cache: new Map() } },
    {
      id: "channel-1",
      guild,
      permissionOverwrites: {
        cache: new Map([["role-x", { id: "role-x", allow: permissions(PermissionFlagsBits.ManageWebhooks), deny: permissions() }]]),
        edit: async () => { edited++; }
      }
    }
  );
  assert.equal(edited, 0, "overwrite-ul acordat de owner ramane");

  auditLookups = 0;
  await runtime.handleChannelUpdate(
    {
      id: "channel-1",
      guild,
      permissionOverwrites: { cache: new Map([["role-x", { id: "role-x", allow: permissions(PermissionFlagsBits.ManageWebhooks), deny: permissions() }]]) }
    },
    {
      id: "channel-1",
      guild,
      permissionOverwrites: {
        cache: new Map([["role-x", { id: "role-x", allow: permissions(PermissionFlagsBits.ManageWebhooks), deny: permissions() }]]),
        edit: async () => { edited++; }
      }
    }
  );
  assert.equal(edited, 0, "un update fara permisiuni sensibile NOI nu restaureaza nimic");
  assert.equal(auditLookups, 0, "fara violare, Audit Log-ul nu e interogat");
});

test("Audit Log intarziat la roleUpdate: intrarea ownerului gasita la reincercare => schimbarea legitima NU e restaurata (raport post-#705, #6)", async () => {
  let restored = 0;
  let fetchCalls = 0;
  const waits: number[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => {
      fetchCalls++;
      if (fetchCalls < 2) return { entries: new Map() };
      return {
        entries: new Map([["entry", {
          target: { id: "role-1" },
          executor: { id: "owner-1" },
          createdTimestamp: now
        }]])
      };
    }
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel([]),
    adminAlert: async () => undefined,
    now: () => now,
    wait: async ms => { waits.push(ms); }
  });

  await runtime.handleRoleUpdate(
    { id: "role-1", permissions: permissions(), guild },
    {
      id: "role-1",
      permissions: permissions(PermissionFlagsBits.BanMembers),
      guild,
      setPermissions: async () => { restored++; }
    }
  );

  assert.equal(fetchCalls, 2, "Audit Log-ul e recitit dupa prima incercare esuata");
  assert.deepEqual(waits, [2_000], "reincercarea e scurta si controlata, ca la bot-add");
  assert.equal(restored, 0, "schimbarea legitima a ownerului NU mai e tratata ca neautorizata");
});

test("actor nedetectat dupa toate reincercarile => restaurarea se aplica abia dupa epuizarea retry-urilor (channelUpdate)", async () => {
  let edited = 0;
  let fetchCalls = 0;
  const waits: number[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => { fetchCalls++; return { entries: new Map() }; }
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel([]),
    adminAlert: async () => undefined,
    now: () => now,
    wait: async ms => { waits.push(ms); }
  });

  await runtime.handleChannelUpdate(
    { id: "channel-1", guild, permissionOverwrites: { cache: new Map() } },
    {
      id: "channel-1",
      guild,
      permissionOverwrites: {
        cache: new Map([["role-x", { id: "role-x", allow: permissions(PermissionFlagsBits.ManageWebhooks), deny: permissions() }]]),
        edit: async () => { edited++; }
      }
    }
  );

  assert.deepEqual(waits, [2_000, 5_000], "toate reincercarile sunt epuizate inainte de restaurare");
  assert.equal(fetchCalls, 6, "fiecare incercare verifica ambele tipuri de evenimente de overwrite (3 incercari x 2 tipuri)");
  assert.equal(edited, 1, "fara actor detectat dupa retry-uri, overwrite-ul neautorizat e restaurat");
});

test("detectia foloseste bitii expliciti, nu has(): un rol cu Administrator NU e tratat ca si cum ar avea toate cele 5 permisiuni explicit (raport audit, #30)", async () => {
  const restored: Array<{ value: bigint }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["e1", { id: "e1", target: { id: "role-1" }, executor: { id: "admin-2" }, createdTimestamp: now }]])
    })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async () => undefined,
    now: () => now
  });

  await runtime.handleRoleUpdate(
    { id: "role-1", permissions: permissions(), guild },
    {
      id: "role-1",
      permissions: permissions(PermissionFlagsBits.Administrator),
      guild,
      setPermissions: async (value: bigint) => { restored.push({ value }); }
    }
  );

  assert.equal(restored.length, 1);
  assert.equal(restored[0].value, 0n, "se elimina EXCLUSIV bitul Administrator adaugat explicit, nu si Ban/Kick/Moderate/Webhooks (care nu sunt biti expliciti)");
  assert.match(audits[0].details ?? "", /removed=Administrator$/, "auditul raporteaza o singura permisiune explicita, nu toate cele 5 implicate de Administrator");
});

test("reincarca starea curenta inainte de restaurare: o modificare legitima concurenta in timpul retry-ului nu e suprascrisa (raport audit, #30)", async () => {
  const restored: Array<{ value: bigint }> = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({ entries: new Map() })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel([]),
    adminAlert: async () => undefined,
    now: () => now,
    wait: async () => {
      nextRole.permissions = permissions(PermissionFlagsBits.SendMessages);
    }
  });
  const nextRole: { id: string; permissions: ReturnType<typeof permissions>; guild: typeof guild; setPermissions: (value: bigint) => Promise<void> } = {
    id: "role-1",
    permissions: permissions(PermissionFlagsBits.Administrator, PermissionFlagsBits.SendMessages),
    guild,
    setPermissions: async (value: bigint) => { restored.push({ value }); }
  };

  await runtime.handleRoleUpdate(
    { id: "role-1", permissions: permissions(), guild },
    nextRole
  );

  assert.equal(restored.length, 0, "Administrator a fost deja retras de o schimbare legitima in timpul retry-ului => nu se mai restaureaza nimic, iar Send Messages ramane neatins");
});

test("dedup Audit Log: aceeasi intrare nu e atribuita de doua ori la doua evenimente diferite (raport audit, #30)", async () => {
  const restored: string[] = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const sharedEntry = { id: "shared-1", target: { id: "role-1" }, executor: { id: "admin-2" }, createdTimestamp: now };
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({ entries: new Map([["shared-1", sharedEntry]]) })
  };
  const runtime = createPermissionDelegationRuntime({
    GuildAuditLogModel: auditModel(audits),
    adminAlert: async () => undefined,
    now: () => now
  });

  await runtime.handleRoleUpdate(
    { id: "role-1", permissions: permissions(), guild },
    { id: "role-1", permissions: permissions(PermissionFlagsBits.Administrator), guild, setPermissions: async () => { restored.push("first"); } }
  );
  await runtime.handleRoleUpdate(
    { id: "role-1", permissions: permissions(), guild },
    { id: "role-1", permissions: permissions(PermissionFlagsBits.BanMembers), guild, setPermissions: async () => { restored.push("second"); } }
  );

  assert.deepEqual(restored, ["first", "second"], "ambele restaurari se aplica (permisiuni diferite)");
  assert.equal(audits[0].userId, "admin-2", "prima atribuie actorul din intrarea audit");
  assert.equal(audits[1].userId, "", "a doua NU reatribuie aceeasi intrare audit deja procesata => actor necunoscut conservator");
});
