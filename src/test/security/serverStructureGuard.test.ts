import test from "node:test";
import assert from "node:assert/strict";

import { createServerStructureGuardRuntime } from "../../features/command-security/serverStructureGuardRuntime.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { moduleContext } from "../moduleContextStub.js";
import type { ServerStructureGuardDeps, StructureGuardGuild } from "../../features/command-security/serverStructureGuardRuntime.js";
import { adaptStructureGuardGuild } from "../../app/runtime/serverStructureGuildAdapter.js";
import type { AdaptableStructureGuild } from "../../app/runtime/serverStructureGuildAdapter.js";

const NOW = Date.parse("2026-08-02T13:00:00.000Z");

function harness(options: {
  guardEnabled?: boolean;
  raidConfirmed?: boolean;
  actorId?: string | null;
  ownerId?: string | null;
  approvals?: ReturnType<typeof permissionRequestStore>;
} = {}) {
  const signals: Array<{ guildId: string; resourceId: string }> = [];
  const removedRoles: string[] = [];
  const published: string[] = [];
  const audits: Array<{ action: string; details: string }> = [];
  const approvals = options.approvals ?? permissionRequestStore();
  const requests = createPermissionRequestRepository(approvals);

  const deps: ServerStructureGuardDeps = {
    gate: {
      readSituation: async () => ({
        guardEnabled: options.guardEnabled ?? true,
        raidConfirmed: options.raidConfirmed ?? false
      }),
      consumeApproval: (guildId, actorId, resourceId, action) =>
        requests.consume(guildId, "server-structure", actorId, { target: resourceId, action }, new Date(NOW))
    },
    publish: async (_guildId, message) => { published.push(message); },
    recordAudit: async (_guildId, entry) => { audits.push({ action: entry.action, details: entry.details }); },
    signalAntiRaid: async (guildId, resourceId) => { signals.push({ guildId, resourceId }); }
  };

  const guild = moduleContext<StructureGuardGuild>({
    id: "g1",
    ownerId: options.ownerId === undefined ? "owner-1" : options.ownerId,
    botHighestRolePosition: 10,
    everyoneRoleId: "everyone",
    findStructureActor: async () => (options.actorId === undefined ? "mod-1" : options.actorId),
    resolveActor: async () => ({
      roles: [{ id: "role-mod", name: "Moderator", position: 5, managed: false, elevated: true }],
      removeRoles: async (ids: readonly string[]) => { removedRoles.push(...ids); }
    })
  });

  return { runtime: createServerStructureGuardRuntime(deps), guild, signals, removedRoles, published, audits, approvals };
}

async function structureApproval(action: string, target: string) {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "server-structure", requesterId: "mod-1",
    target, action, reason: "reorganizare planificata"
  }, new Date(NOW - 60_000));
  await repository.resolve("g1", "req-1", "approved", "owner-1", { target, action }, new Date(NOW - 60_000));
  return model;
}

test("ownerul creeaza un canal: nu se semnaleaza anti-raid si nu se sanctioneaza nimic", async () => {
  const setup = harness({ actorId: "owner-1" });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-1");

  assert.equal(outcome.kind, "allowed-owner");
  assert.deepEqual(setup.signals, [], "o operatiune legitima a ownerului nu mai poate declansa fals un raid");
  assert.deepEqual(setup.removedRoles, []);
});

test("o aprobare server-structure exacta lasa modificarea sa treaca fara semnal anti-raid", async () => {
  const approvals = await structureApproval("delete", "chan-9");
  const setup = harness({ approvals });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelDelete", "chan-9");

  assert.equal(outcome.kind, "allowed-approval");
  assert.deepEqual(setup.signals, [], "operatiunea aprobata nu alimenteaza detectorul de raid");
  assert.equal(approvals.records[0].status, "used", "aprobarea este de unica folosinta");
});

test("o aprobare pentru alta resursa nu acopera modificarea", async () => {
  const approvals = await structureApproval("delete", "chan-9");
  const setup = harness({ approvals });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelDelete", "chan-7");

  assert.equal(outcome.kind, "sanctioned");
  assert.deepEqual(setup.signals, [{ guildId: "g1", resourceId: "chan-7" }]);
  assert.equal(approvals.records[0].status, "approved", "aprobarea pentru alta resursa ramane neconsumata");
});

test("o aprobare pentru alta actiune nu acopera modificarea", async () => {
  const approvals = await structureApproval("create", "chan-9");
  const setup = harness({ approvals });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelDelete", "chan-9");

  assert.equal(outcome.kind, "sanctioned");
  assert.equal(approvals.records[0].status, "approved");
});

test("modificare neaprobata cu poarta activa: semnal anti-raid PLUS sanctiunea moderation-guard", async () => {
  const setup = harness();

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "roleDelete", "role-7");

  assert.equal(outcome.kind, "sanctioned");
  assert.deepEqual(setup.signals, [{ guildId: "g1", resourceId: "role-7" }], "sub pragul de raid semnalul ramane, ca detectorul sa poata acumula");
  assert.deepEqual(setup.removedRoles, ["role-mod"]);
  assert.equal(setup.audits[0]?.action, "server-structure-unapproved");
  assert.match(setup.published[0] ?? "", /rol sters/);
  assert.match(setup.published[0] ?? "", /NU se anuleaza automat/, "mesajul nu pretinde ca structura a fost restaurata");
});

test("cu moderation-guard oprit, comportamentul de dinainte ramane: doar semnal anti-raid", async () => {
  const setup = harness({ guardEnabled: false });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-2");

  assert.equal(outcome.kind, "signalled");
  assert.deepEqual(setup.signals, [{ guildId: "g1", resourceId: "chan-2" }]);
  assert.deepEqual(setup.removedRoles, [], "fara poarta activa nu se sanctioneaza nimeni");
});

test("in timpul unui raid confirmat, decizia ramane la anti-raid", async () => {
  const setup = harness({ raidConfirmed: true });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelDelete", "chan-3");

  assert.equal(outcome.kind, "signalled");
  assert.deepEqual(setup.signals, [{ guildId: "g1", resourceId: "chan-3" }]);
  assert.deepEqual(setup.removedRoles, [], "anti-raid aplica singur sanctiunile in incident");
});

test("cand autorul nu poate fi identificat, semnalul pleaca dar nu se sanctioneaza nimeni", async () => {
  const setup = harness({ actorId: null });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "roleCreate", "role-9");

  assert.deepEqual(outcome, { kind: "signalled", actorId: null });
  assert.deepEqual(setup.signals, [{ guildId: "g1", resourceId: "role-9" }]);
  assert.deepEqual(setup.removedRoles, []);
});

function auditGuild(entriesByType: Record<number, Array<{ executor: string; target: string; at: number }>>, attempts: number[] = []) {
  return moduleContext<AdaptableStructureGuild>({
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async (options: { type?: number }) => {
      attempts.push(options?.type ?? -1);
      const rows = entriesByType[options?.type ?? -1] ?? [];
      return {
        entries: new Map(rows.map((row, index) => [String(index), {
          executor: { id: row.executor },
          target: { id: row.target },
          createdTimestamp: row.at
        }]))
      };
    }
  });
}

test("cautarea autorului filtreaza dupa tipul evenimentului, nu ia orice actiune pe aceeasi resursa", async () => {
  const attempts: number[] = [];
  const guild = adaptStructureGuardGuild(auditGuild({
    12: [{ executor: "vinovat", target: "chan-1", at: NOW }],
    11: [{ executor: "nevinovat", target: "chan-1", at: NOW }]
  }, attempts), () => NOW, async () => undefined);

  const actor = await guild?.findStructureActor("channelDelete", "chan-1");

  assert.equal(actor, "vinovat", "un update pe acelasi canal nu poate fi confundat cu stergerea lui");
  assert.deepEqual([...new Set(attempts)], [12], "se interogheaza doar evenimentul de stergere de canal");
});

test("cautarea autorului reincearca daca intrarea din Audit Log nu e inca vizibila", async () => {
  const attempts: number[] = [];
  let calls = 0;
  const guild = adaptStructureGuardGuild(moduleContext<AdaptableStructureGuild>({
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async (options: { type?: number }) => {
      attempts.push(options?.type ?? -1);
      calls += 1;
      if (calls < 3) return { entries: new Map() };
      return {
        entries: new Map([["e", { executor: { id: "intarziat" }, target: { id: "role-1" }, createdTimestamp: NOW }]])
      };
    }
  }), () => NOW, async () => undefined);

  const actor = await guild?.findStructureActor("roleDelete", "role-1");

  assert.equal(actor, "intarziat", "evenimentul de gateway poate sosi inaintea intrarii din Audit Log");
  assert.equal(attempts.length, 3, "se reincearca de trei ori, apoi se renunta");
});

test("dupa toate reincercarile fara rezultat, autorul ramane necunoscut", async () => {
  const guild = adaptStructureGuardGuild(auditGuild({}), () => NOW, async () => undefined);

  assert.equal(await guild?.findStructureActor("channelCreate", "chan-9"), null);
});

test("o intrare mai veche decat fereastra de corelare nu este atribuita", async () => {
  const guild = adaptStructureGuardGuild(auditGuild({
    10: [{ executor: "vechi", target: "chan-1", at: NOW - 120_000 }]
  }), () => NOW, async () => undefined);

  assert.equal(await guild?.findStructureActor("channelCreate", "chan-1"), null);
});
