import test from "node:test";
import assert from "node:assert/strict";

import { createProtectedResourceRuntime } from "../../features/command-security/protectedResourceRuntime.js";
import { createProtectedResourceRepository } from "../../features/command-security/protectedResourceRepository.js";
import { captureSnapshot } from "../../features/command-security/protectedResourceTypes.js";
import { planRoleSanction, renderIncident } from "../../features/command-security/protectedResourceSanction.js";
import { protectedResourceStore } from "./protectedResourceStore.js";

import type { ProtectedResourceGuild } from "../../features/command-security/protectedResourceRuntime.js";
import type { SanctionRole } from "../../features/command-security/protectedResourceSanction.js";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function channel(overrides: Record<string, unknown> = {}) {
  return {
    name: "reguli",
    rawPosition: 1,
    parentId: "cat-1",
    type: 0,
    permissionOverwrites: { cache: { values: () => [{ id: "everyone", type: 0, allow: 0n, deny: 1024n }] } },
    ...overrides
  };
}

function role(id: string, name: string, position: number, elevated: boolean, managed = false): SanctionRole {
  return { id, name, position, managed, elevated };
}

function harness(options: {
  guardEnabled?: boolean;
  raidConfirmed?: boolean;
  auditActor?: string | null;
  approval?: { _id: string } | null;
  actorRoles?: readonly SanctionRole[];
  restoreOk?: boolean;
  recreatedId?: string | null;
  ownerId?: string;
} = {}) {
  const published: string[] = [];
  const restored: string[] = [];
  const recreated: string[] = [];
  const removedRoles: string[][] = [];
  const model = protectedResourceStore();
  const repository = createProtectedResourceRepository(model);

  const runtime = createProtectedResourceRuntime({
    ProtectedResourceModel: model,
    guard: {
      readSituation: async () => ({
        guardEnabled: options.guardEnabled ?? true,
        raidConfirmed: options.raidConfirmed ?? false
      }),
      consumeResourceApproval: async () => options.approval ?? null
    },
    publish: async (_guildId, body) => { published.push(body); return undefined; },
    now: () => NOW
  });

  const guild: ProtectedResourceGuild = {
    id: "g1",
    ownerId: options.ownerId ?? "owner-1",
    everyoneRoleId: "everyone",
    botHighestRolePosition: 50,
    resolveActor: async actorId => ({
      id: actorId,
      roles: options.actorRoles ?? [],
      removeRoles: async ids => { removedRoles.push([...ids]); return undefined; }
    }),
    findAuditActor: async () => (options.auditActor === undefined ? "mod-1" : options.auditActor),
    restoreChannel: async id => { restored.push(id); return options.restoreOk ?? true; },
    restoreRole: async id => { restored.push(id); return options.restoreOk ?? true; },
    recreateChannel: async () => { recreated.push("channel"); return options.recreatedId === undefined ? "canal-nou" : options.recreatedId; },
    recreateRole: async () => { recreated.push("role"); return options.recreatedId === undefined ? "rol-nou" : options.recreatedId; }
  };

  return { runtime, guild, repository, model, published, restored, recreated, removedRoles };
}

async function protect(harnessed: ReturnType<typeof harness>, type: "channel" | "role" = "channel") {
  await harnessed.repository.add({
    guildId: "g1", resourceId: "c1", type, addedBy: "owner-1",
    snapshot: captureSnapshot(channel()), degraded: false, degradedReasons: [], preventionApplied: true
  });
}

test("o resursa neprotejata nu declanseaza nimic", async () => {
  const setup = harness();
  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "necunoscut", channel({ name: "altceva" }));

  assert.deepEqual(outcome, { kind: "not-protected" });
  assert.equal(setup.published.length, 0);
});

test("cu moderation-guard oprit nu se sanctioneaza, dar snapshot-ul urmareste realitatea", async () => {
  const setup = harness({ guardEnabled: false });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel({ name: "redenumit" }));

  assert.deepEqual(outcome, { kind: "guard-off" });
  assert.equal(setup.published.length, 0);
  assert.equal(setup.restored.length, 0);
  const stored = await setup.repository.read("g1", "c1");
  assert.equal(stored?.snapshot.name, "redenumit", "fara poarta activa, snapshot-ul nu are voie sa ramana in urma");
});

test("in timpul unui raid confirmat, protectia resurselor nu produce actiune duplicata", async () => {
  const setup = harness({ raidConfirmed: true });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel({ name: "redenumit" }));

  assert.deepEqual(outcome, { kind: "raid-active" });
  assert.equal(setup.published.length, 0);
  assert.equal(setup.restored.length, 0);
});

test("o modificare identica cu snapshot-ul nu e tratata ca incident", async () => {
  const setup = harness();
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel());

  assert.deepEqual(outcome, { kind: "no-change" });
  assert.equal(setup.restored.length, 0);
});

test("ownerul modifica direct, iar snapshot-ul se actualizeaza la noua stare", async () => {
  const setup = harness({ auditActor: "owner-1" });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel({ name: "owner-a-schimbat" }));

  assert.deepEqual(outcome, { kind: "allowed-owner" });
  assert.equal(setup.restored.length, 0);
  assert.equal(setup.published.length, 0);
  assert.equal((await setup.repository.read("g1", "c1"))?.snapshot.name, "owner-a-schimbat");
});

test("o aprobare exacta lasa modificarea sa treaca si muta snapshot-ul", async () => {
  const setup = harness({ approval: { _id: "req-9" } });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel({ parentId: "cat-2" }));

  assert.deepEqual(outcome, { kind: "allowed-approval", requestId: "req-9" });
  assert.equal(setup.restored.length, 0);
  assert.equal((await setup.repository.read("g1", "c1"))?.snapshot.parentId, "cat-2");
});

test("autorul neconfirmat prin Audit Log NU produce sanctiune si nu restaureaza orbeste", async () => {
  const setup = harness({ auditActor: null });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel({ name: "cine-a-facut" }));

  assert.equal(outcome.kind, "actor-unknown");
  assert.equal(setup.removedRoles.length, 0, "specificatia interzice sanctionarea unei persoane alese la intamplare");
  assert.equal(setup.published.length, 0);
  assert.equal((await setup.repository.read("g1", "c1"))?.snapshot.name, "reguli",
    "snapshot-ul ramane referinta buna cat timp incidentul nu e atribuit");
});

test("o modificare neautorizata e restaurata, autorul isi pierde rolurile si incidentul e publicat", async () => {
  const setup = harness({
    actorRoles: [role("r-mod", "Moderator", 10, true), role("r-membru", "Membru", 2, false)]
  });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceUpdate(setup.guild, "c1", channel({ name: "furat" }));

  assert.deepEqual(outcome, { kind: "corrected", actions: ["rename"], restored: true, recreatedId: null });
  assert.deepEqual(setup.restored, ["c1"]);
  assert.deepEqual(setup.removedRoles, [["r-mod"]], "se elimina doar rolurile cu permisiuni ridicate");
  assert.match(setup.published[0], /<@mod-1>/);
  assert.match(setup.published[0], /Moderator/);
  assert.match(setup.published[0], /redenumire/);
});

test("un canal protejat sters este recreat din snapshot, cu ID nou legat de cel vechi", async () => {
  const setup = harness({ actorRoles: [role("r-mod", "Moderator", 10, true)] });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceDelete(setup.guild, "c1");

  assert.deepEqual(outcome, { kind: "corrected", actions: ["delete"], restored: true, recreatedId: "canal-nou" });
  assert.equal(await setup.repository.read("g1", "c1"), null);
  const rebound = await setup.repository.read("g1", "canal-nou");
  assert.equal(rebound?.recreatedFromId, "c1");
  assert.equal(rebound?.snapshot.name, "reguli", "snapshot-ul trece la resursa recreata");
  assert.match(setup.published[0], /nu pot fi recuperate/);
});

test("cand recrearea esueaza, incidentul o spune in loc sa pretinda ca s-a restaurat", async () => {
  const setup = harness({ recreatedId: null, actorRoles: [] });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceDelete(setup.guild, "c1");

  assert.equal(outcome.kind, "corrected");
  assert.equal(outcome.kind === "corrected" && outcome.restored, false);
  assert.match(setup.published[0], /NU a putut fi restaurata/);
});

test("stergerea de catre owner scoate resursa din protectie fara sa o recreeze", async () => {
  const setup = harness({ auditActor: "owner-1" });
  await protect(setup);

  const outcome = await setup.runtime.handleResourceDelete(setup.guild, "c1");

  assert.deepEqual(outcome, { kind: "allowed-owner" });
  assert.equal(setup.recreated.length, 0, "ownerul care sterge intentionat nu primeste canalul inapoi");
  assert.equal(await setup.repository.read("g1", "c1"), null);
});

test("rolurile gestionate de integrare si cele peste rolul botului sunt raportate ca neeliminabile", () => {
  const plan = planRoleSanction({
    actorRoles: [
      role("r1", "Moderator", 10, true),
      role("r2", "Bot Premium", 20, true, true),
      role("r3", "Head Admin", 80, true),
      role("everyone", "@everyone", 0, true)
    ],
    botHighestRolePosition: 50,
    everyoneRoleId: "everyone"
  });

  assert.deepEqual(plan.removable.map(entry => entry.id), ["r1"]);
  assert.deepEqual(plan.blocked.map(entry => entry.id), ["r2", "r3"]);
  assert.match(renderIncident({
    actorId: "u1", resourceLabel: "channel `c1`", actions: ["permissions"],
    restored: true, recreatedId: null, plan
  }), /NU au putut fi eliminate/);
});

test("un autor fara roluri cu permisiuni ridicate primeste un raport onest, nu unul gol", () => {
  const plan = planRoleSanction({
    actorRoles: [role("r1", "Membru", 1, false)],
    botHighestRolePosition: 50,
    everyoneRoleId: "everyone"
  });

  assert.deepEqual(plan.removable, []);
  assert.deepEqual(plan.blocked, []);
  assert.match(renderIncident({
    actorId: "u1", resourceLabel: "role `r9`", actions: ["delete"],
    restored: false, recreatedId: null, plan
  }), /nu avea roluri cu permisiuni ridicate/);
});
