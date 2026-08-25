import test from "node:test";
import assert from "node:assert/strict";

import { createServerStructureGuardRuntime } from "../../features/command-security/serverStructureGuardRuntime.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { moduleContext } from "../moduleContextStub.js";
import { emptySnapshot } from "../../features/command-security/protectedResourceTypes.js";
import { batchTarget } from "../../features/command-security/permissionRequestTypes.js";
import type { ServerStructureGuardDeps, StructureGuardGuild } from "../../features/command-security/serverStructureGuardRuntime.js";
import { adaptStructureGuardGuild } from "../../app/runtime/serverStructureGuildAdapter.js";
import type { AdaptableStructureGuild } from "../../app/runtime/serverStructureGuildAdapter.js";

const NOW = Date.parse("2026-08-02T13:00:00.000Z");

const SNAPSHOT = { ...emptySnapshot(), name: "anunturi", channelType: 0 };

function harness(options: {
  guardEnabled?: boolean;
  raidConfirmed?: boolean;
  actorId?: string | null;
  ownerId?: string | null;
  approvals?: ReturnType<typeof permissionRequestStore>;
  live?: readonly string[];
  removeFails?: boolean;
  removeLeavesResource?: boolean;
  recreateFails?: boolean;
  recreateUnconfirmed?: boolean;
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

  const live = new Set<string>(options.live ?? []);
  const removedResources: string[] = [];
  const recreated: Array<{ kind: string; name: string }> = [];

  const guild = moduleContext<StructureGuardGuild>({
    id: "g1",
    ownerId: options.ownerId === undefined ? "owner-1" : options.ownerId,
    botHighestRolePosition: 10,
    everyoneRoleId: "everyone",
    findStructureActor: async () => (options.actorId === undefined ? "mod-1" : options.actorId),
    resolveActor: async () => ({
      roles: [{ id: "role-mod", name: "Moderator", position: 5, managed: false, elevated: true }],
      removeRoles: async (ids: readonly string[]) => { removedRoles.push(...ids); }
    }),
    removeCreatedResource: async (_kind: string, resourceId: string) => {
      if (options.removeFails) return false;
      removedResources.push(resourceId);
      if (!options.removeLeavesResource) live.delete(resourceId);
      return true;
    },
    recreateDeletedResource: async (kind: string, snapshot: { name: string }) => {
      if (options.recreateFails) return null;
      recreated.push({ kind, name: snapshot.name });
      const id = `recreat-${recreated.length}`;
      if (!options.recreateUnconfirmed) live.add(id);
      return id;
    },
    resourceExists: async (_kind: string, resourceId: string) => live.has(resourceId)
  });

  return {
    runtime: createServerStructureGuardRuntime(deps), guild, signals, removedRoles, published, audits, approvals,
    removedResources, recreated, live
  };
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

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "roleDelete", "role-7", SNAPSHOT);

  assert.equal(outcome.kind, "sanctioned");
  assert.deepEqual(setup.signals, [{ guildId: "g1", resourceId: "role-7" }], "sub pragul de raid semnalul ramane, ca detectorul sa poata acumula");
  assert.deepEqual(setup.removedRoles, ["role-mod"]);
  assert.match(setup.audits[0]?.action ?? "", /^server-structure-unapproved/);
  assert.match(setup.published[0] ?? "", /rol sters/);
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

  assert.equal(outcome.kind, "signalled");
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

test("un canal creat fara aprobare este sters, nu doar semnalat (F-14)", async () => {
  const setup = harness({ live: ["chan-nou"] });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-nou");

  assert.equal(outcome.kind, "sanctioned");
  assert.deepEqual(setup.removedResources, ["chan-nou"], "o resursa creata malitios nu are voie sa ramana activa dupa sanctionarea autorului");
  assert.equal(outcome.kind === "sanctioned" && outcome.rollback.verified, true, "absenta resursei se confirma, nu se presupune");
  assert.match(setup.published[0] ?? "", /a fost stearsa si absenta ei e confirmata/);
});

test("un canal sters fara aprobare este recreat din snapshot (F-14)", async () => {
  const setup = harness();

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelDelete", "chan-vechi", SNAPSHOT);

  assert.deepEqual(setup.recreated, [{ kind: "channelDelete", name: "anunturi" }]);
  assert.equal(outcome.kind === "sanctioned" && outcome.rollback.recreatedId, "recreat-1");
  assert.equal(outcome.kind === "sanctioned" && outcome.rollback.verified, true);
  assert.match(setup.published[0] ?? "", /a fost recreata/);
});

test("stergerea resursei create raporteaza esec daca resursa ramane vizibila (F-14)", async () => {
  const setup = harness({ live: ["chan-nou"], removeLeavesResource: true });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-nou");

  assert.equal(outcome.kind === "sanctioned" && outcome.rollback.verified, false, "un apel de stergere care raporteaza succes nu inseamna ca resursa a disparut");
  assert.match(setup.published[0] ?? "", /Revenire incompleta/);
  assert.match(setup.audits[0]?.details ?? "", /neconfirmata/);
});

test("fara snapshot, recrearea nu se incearca si mesajul spune de ce (F-14)", async () => {
  const setup = harness();

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "roleDelete", "role-7", null);

  assert.deepEqual(setup.recreated, []);
  assert.equal(outcome.kind === "sanctioned" && outcome.rollback.attempted, false);
  assert.match(setup.published[0] ?? "", /Revenire neincercata/);
});

test("recrearea esuata nu e raportata ca revenire reusita (F-14)", async () => {
  const setup = harness({ recreateFails: true });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "roleDelete", "role-7", SNAPSHOT);

  assert.equal(outcome.kind === "sanctioned" && outcome.rollback.reverted, false);
  assert.match(setup.published[0] ?? "", /Revenire incompleta/);
});

test("cand autorul e necunoscut, structura se repara oricum (F-14)", async () => {
  const setup = harness({ actorId: null, live: ["chan-nou"] });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-nou");

  assert.equal(outcome.kind, "signalled");
  assert.deepEqual(setup.removedResources, ["chan-nou"], "o modificare neautorizata ramane neautorizata si cand Audit Log nu da autorul");
  assert.deepEqual(setup.removedRoles, [], "fara autor identificat nu se sanctioneaza nimeni");
});

test("in raid confirmat structura se corecteaza imediat, dar fara sanctiune (F-30)", async () => {
  const setup = harness({ raidConfirmed: true, live: ["chan-nou"] });

  const outcome = await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-nou");

  assert.equal(outcome.kind, "signalled");
  assert.deepEqual(setup.removedResources, ["chan-nou"], "corectia se face inaintea escaladarii, nu abia la recovery");
  assert.deepEqual(setup.removedRoles, [], "sanctionarea autorului ramane la anti-raid, ca sa nu se dubleze");
  assert.equal(outcome.kind === "signalled" && outcome.rollback?.verified, true);
});

test("cu moderation-guard oprit nu se repara nimic (F-14)", async () => {
  const setup = harness({ guardEnabled: false, live: ["chan-nou"] });

  await setup.runtime.handleStructureChange(setup.guild, "channelCreate", "chan-nou");

  assert.deepEqual(setup.removedResources, [], "poarta oprita inseamna observare, nu interventie");
});

test("adapterul de productie chiar sterge resursa creata si o recreeaza pe cea stearsa (F-14)", async () => {
  const deleted: string[] = [];
  const createdChannels: Array<Record<string, unknown>> = [];
  const createdRoles: Array<Record<string, unknown>> = [];
  const channels = new Map<string, unknown>([["chan-nou", { delete: async (reason: string) => { deleted.push(`chan-nou:${reason}`); } }]]);

  const guild = adaptStructureGuardGuild(moduleContext<AdaptableStructureGuild>({
    id: "g1",
    ownerId: "owner-1",
    channels: {
      cache: { get: (id: string) => channels.get(id) },
      create: async (payload: Record<string, unknown>) => { createdChannels.push(payload); return { id: "chan-recreat" }; }
    },
    roles: {
      everyone: { id: "everyone" },
      cache: { get: () => undefined },
      create: async (payload: Record<string, unknown>) => { createdRoles.push(payload); return { id: "role-recreat" }; }
    }
  }), () => NOW, async () => undefined);

  assert.equal(await guild?.removeCreatedResource("channelCreate", "chan-nou", "fara aprobare"), true);
  assert.deepEqual(deleted, ["chan-nou:fara aprobare"], "portul de revenire trebuie sa ajunga la stergerea reala, nu doar sa raporteze succes");
  assert.equal(await guild?.resourceExists("channelCreate", "chan-nou"), true, "verificarea citeste starea reala, nu rezultatul apelului");

  assert.equal(await guild?.recreateDeletedResource("channelDelete", SNAPSHOT), "chan-recreat");
  assert.equal(createdChannels[0]?.name, "anunturi");
  assert.equal(await guild?.recreateDeletedResource("roleDelete", { ...SNAPSHOT, name: "Staff", channelType: null }), "role-recreat");
  assert.equal(createdRoles[0]?.name, "Staff", "un rol sters nu are voie sa fie recreat ca si canal");
});

test("fara permisiunea de a sterge, revenirea raporteaza esec in loc sa arunce (F-14)", async () => {
  const guild = adaptStructureGuardGuild(moduleContext<AdaptableStructureGuild>({
    id: "g1",
    ownerId: "owner-1",
    channels: { cache: { get: () => ({}) } },
    roles: { everyone: { id: "everyone" }, cache: { get: () => undefined } }
  }), () => NOW, async () => undefined);

  assert.equal(await guild?.removeCreatedResource("channelCreate", "chan-nou", "fara aprobare"), false);
  assert.equal(await guild?.recreateDeletedResource("channelDelete", SNAPSHOT), null);
});

async function batchApproval(action: string, resourceKind: string, amount: number) {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  const target = batchTarget(resourceKind);
  await repository.create({
    requestId: "req-lot", guildId: "g1", type: "server-structure", requesterId: "mod-1",
    target, action, amount, reason: "reorganizare planificata"
  }, new Date(NOW - 60_000));
  await repository.resolve("g1", "req-lot", "approved", "owner-1", { target, action, amount }, new Date(NOW - 60_000));
  return model;
}

function batchHarness(approvals: ReturnType<typeof permissionRequestStore>) {
  const setup = harness({ approvals, live: [] });
  const requests = createPermissionRequestRepository(approvals);
  const consumeWithBatch = async (guildId: string, actorId: string, resourceId: string, action: string, resourceKind: string) => {
    const exact = await requests
      .consume(guildId, "server-structure", actorId, { target: resourceId, action }, new Date(NOW))
      .catch(() => null);
    return exact ?? requests
      .consume(guildId, "server-structure", actorId, { target: batchTarget(resourceKind), action, resourceKind }, new Date(NOW));
  };
  return { setup, consumeWithBatch };
}

test("o aprobare de lot acopera mai multe resurse, nu se epuizeaza la primul eveniment (F-49)", async () => {
  const approvals = await batchApproval("create", "channel", 3);
  const requests = createPermissionRequestRepository(approvals);

  for (const resourceId of ["chan-1", "chan-2", "chan-3"]) {
    const claimed = await requests.consume("g1", "server-structure", "mod-1",
      { target: batchTarget("channel"), action: "create", resourceKind: "channel" }, new Date(NOW));
    assert.ok(claimed, `evenimentul pentru ${resourceId} trebuie acoperit de lot`);
  }

  assert.equal(approvals.records[0].status, "used", "dupa a treia operatiune lotul e consumat complet");
});

test("lotul se epuizeaza exact la cantitatea aprobata (F-49)", async () => {
  const approvals = await batchApproval("create", "channel", 2);
  const requests = createPermissionRequestRepository(approvals);

  await requests.consume("g1", "server-structure", "mod-1", { target: batchTarget("channel"), action: "create", resourceKind: "channel" }, new Date(NOW));
  await requests.consume("g1", "server-structure", "mod-1", { target: batchTarget("channel"), action: "create", resourceKind: "channel" }, new Date(NOW));
  const third = await requests.consume("g1", "server-structure", "mod-1", { target: batchTarget("channel"), action: "create", resourceKind: "channel" }, new Date(NOW));

  assert.equal(third, null, "a treia operatiune depaseste cantitatea aprobata");
});

test("un lot pe canale nu acopera operatiuni pe roluri (F-49)", async () => {
  const approvals = await batchApproval("create", "channel", 5);
  const requests = createPermissionRequestRepository(approvals);

  const claimed = await requests.consume("g1", "server-structure", "mod-1",
    { target: batchTarget("role"), action: "create", resourceKind: "role" }, new Date(NOW));

  assert.equal(claimed, null, "tipul de resursa face parte din scope, altfel un lot de canale ar acoperi si crearea de roluri");
});

test("un lot de creare nu acopera stergeri (F-49)", async () => {
  const approvals = await batchApproval("create", "channel", 5);
  const requests = createPermissionRequestRepository(approvals);

  const claimed = await requests.consume("g1", "server-structure", "mod-1",
    { target: batchTarget("channel"), action: "delete", resourceKind: "channel" }, new Date(NOW));

  assert.equal(claimed, null);
});

test("decrementul lotului e vizibil intre operatiuni, nu doar la final (F-49)", async () => {
  const approvals = await batchApproval("delete", "role", 3);
  const requests = createPermissionRequestRepository(approvals);

  await requests.consume("g1", "server-structure", "mod-1", { target: batchTarget("role"), action: "delete", resourceKind: "role" }, new Date(NOW));
  const afterOne = approvals.records[0].remainingAmount;
  await requests.consume("g1", "server-structure", "mod-1", { target: batchTarget("role"), action: "delete", resourceKind: "role" }, new Date(NOW));

  assert.equal(afterOne, 2, "fara decrement persistat, o repornire ar reda lotului cantitatea initiala");
  assert.equal(approvals.records[0].remainingAmount, 1);
  assert.equal(approvals.records[0].status, "approved", "lotul ramane activ cat timp mai are capacitate");
});

test("in runtime, o aprobare exacta e preferata lotului (F-49)", async () => {
  const approvals = await batchApproval("delete", "channel", 2);
  const repository = createPermissionRequestRepository(approvals);
  await repository.create({
    requestId: "req-exact", guildId: "g1", type: "server-structure", requesterId: "mod-1",
    target: "chan-9", action: "delete", reason: "canal anume"
  }, new Date(NOW - 60_000));
  await repository.resolve("g1", "req-exact", "approved", "owner-1", { target: "chan-9", action: "delete" }, new Date(NOW - 60_000));

  const { consumeWithBatch } = batchHarness(approvals);
  const claimed = await consumeWithBatch("g1", "mod-1", "chan-9", "delete", "channel");

  assert.equal(claimed?._id, "req-exact", "aprobarea punctuala se consuma prima, ca lotul sa ramana pentru restul resurselor");
  assert.equal(approvals.records.find(record => record._id === "req-lot")?.remainingAmount, 2, "lotul ramane neatins");
});
