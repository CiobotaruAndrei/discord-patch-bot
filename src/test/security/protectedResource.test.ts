import test from "node:test";
import assert from "node:assert/strict";

import {
  captureSnapshot,
  diffSnapshot,
  emptySnapshot,
  isProtectedResourceType
} from "../../features/command-security/protectedResourceTypes.js";
import { evaluateProtectionReadiness } from "../../features/command-security/protectedResourceReadiness.js";
import {
  PROTECTED_RESOURCE_LIMIT,
  createProtectedResourceRepository
} from "../../features/command-security/protectedResourceRepository.js";
import { protectedResourceLines } from "../../features/command-presentation/protectedResourceMessages.js";
import type { ProtectedResourceRecord } from "../../features/command-security/protectedResourceTypes.js";

type Doc = Record<string, unknown>;

const FULL_CAPABILITY = {
  botHighestRolePosition: 50,
  botCanManageChannels: true,
  botCanManageRoles: true,
  botCanViewAuditLog: true
};

function store(records: Doc[] = []) {
  function matches(record: Doc, filter: Doc): boolean {
    return Object.entries(filter).every(([key, expected]) => record[key] === expected);
  }
  return {
    records,
    findOne(filter: Doc) {
      const found = records.find(record => matches(record, filter)) ?? null;
      return { lean: async (): Promise<Doc | null> => (found ? { ...found } : null) };
    },
    find(filter: Doc) {
      const found = records.filter(record => matches(record, filter));
      return { sort: () => ({ limit: (count: number) => ({ lean: async (): Promise<Doc[]> => found.slice(0, count).map(record => ({ ...record })) }) }) };
    },
    async updateOne(filter: Doc, update: Doc, options?: Doc) {
      const existing = records.find(record => matches(record, filter));
      if (!existing) {
        if (options?.upsert && update.$setOnInsert) {
          records.push(update.$setOnInsert as Doc);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (update.$set) Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter: Doc) {
      const index = records.findIndex(record => matches(record, filter));
      if (index < 0) return { deletedCount: 0 };
      records.splice(index, 1);
      return { deletedCount: 1 };
    }
  };
}

function channelLike(overrides: Record<string, unknown> = {}) {
  return {
    name: "anunturi",
    rawPosition: 3,
    parentId: "cat-1",
    topic: "reguli",
    nsfw: false,
    type: 0,
    permissionOverwrites: {
      cache: {
        values: () => [
          { id: "role-b", type: 0, allow: 2048n, deny: 0n },
          { id: "role-a", type: 0, allow: 0n, deny: 1024n }
        ]
      }
    },
    ...overrides
  };
}

test("tipurile acceptate sunt exact cele trei din specificatie", () => {
  assert.equal(isProtectedResourceType("channel"), true);
  assert.equal(isProtectedResourceType("category"), true);
  assert.equal(isProtectedResourceType("role"), true);
  assert.equal(isProtectedResourceType("emoji"), false);
});

test("snapshot-ul salveaza starea canalului si ordoneaza overwrite-urile stabil", () => {
  const snapshot = captureSnapshot(channelLike());

  assert.equal(snapshot.name, "anunturi");
  assert.equal(snapshot.position, 3);
  assert.equal(snapshot.parentId, "cat-1");
  assert.deepEqual(snapshot.overwrites.map(entry => entry.id), ["role-a", "role-b"],
    "ordinea din cache-ul Discord nu e garantata; fara sortare, doua snapshot-uri identice ar parea diferite");
  assert.equal(snapshot.overwrites[1].allow, "2048", "bitfield-urile se salveaza ca text, ca sa nu se piarda din precizie");
});

test("diferenta de snapshot numeste exact ce s-a schimbat", () => {
  const before = captureSnapshot(channelLike());

  assert.deepEqual(diffSnapshot(before, captureSnapshot(channelLike())), [], "acelasi canal nu produce nicio modificare");
  assert.deepEqual(diffSnapshot(before, captureSnapshot(channelLike({ name: "altceva" }))), ["rename"]);
  assert.deepEqual(diffSnapshot(before, captureSnapshot(channelLike({ parentId: "cat-2" }))), ["move"]);
  assert.deepEqual(diffSnapshot(before, captureSnapshot(channelLike({ rawPosition: 9 }))), ["reposition"]);
  assert.deepEqual(
    diffSnapshot(before, captureSnapshot(channelLike({
      permissionOverwrites: { cache: { values: () => [{ id: "role-a", type: 0, allow: 8n, deny: 0n }] } }
    }))),
    ["permissions"]
  );
});

test("un canal fara roluri privilegiate primeste protectie completa", () => {
  const verdict = evaluateProtectionReadiness(FULL_CAPABILITY, {
    type: "channel",
    managerRoles: [{ id: "r1", name: "Membru", position: 2, administrator: false }],
    managerMembers: []
  });

  assert.equal(verdict.degraded, false);
  assert.equal(verdict.preventable, true);
  assert.deepEqual(verdict.reasons, []);
});

test("un rol cu Administrator face canalul degraded, cu cauza numita", () => {
  const verdict = evaluateProtectionReadiness(FULL_CAPABILITY, {
    type: "channel",
    managerRoles: [{ id: "r1", name: "Staff", position: 10, administrator: true }],
    managerMembers: []
  });

  assert.equal(verdict.degraded, true);
  assert.equal(verdict.preventable, false, "Administrator ignora overwrite-urile canalului, deci prevenirea nu e garantata");
  assert.match(verdict.reasons.join(" "), /Staff/);
});

test("fara View Audit Log resursa e degraded, fiindca autorul nu poate fi confirmat", () => {
  const verdict = evaluateProtectionReadiness(
    { ...FULL_CAPABILITY, botCanViewAuditLog: false },
    { type: "category", managerRoles: [], managerMembers: [] }
  );

  assert.equal(verdict.degraded, true);
  assert.match(verdict.reasons[0], /View Audit Log/);
});

test("un rol protejat sub rolul botului dar sub un administrator ramane degraded", () => {
  const verdict = evaluateProtectionReadiness(FULL_CAPABILITY, {
    type: "role",
    rolePosition: 20,
    rolesBelow: [{ id: "r1", name: "Membru", position: 5 }],
    rolesAbove: [{ id: "r2", name: "Head Mod", position: 30 }]
  });

  assert.equal(verdict.degraded, true);
  assert.equal(verdict.preventable, false);
  assert.match(verdict.reasons.join(" "), /Head Mod/);
});

test("un rol deasupra rolului botului nu poate fi restaurat si o spune explicit", () => {
  const verdict = evaluateProtectionReadiness(
    { ...FULL_CAPABILITY, botHighestRolePosition: 10 },
    { type: "role", rolePosition: 40, rolesBelow: [], rolesAbove: [] }
  );

  assert.equal(verdict.degraded, true);
  assert.match(verdict.reasons.join(" "), /nu este deasupra rolului protejat/);
});

test("fara Manage Roles, protectia rolului nu porneste deloc", () => {
  const verdict = evaluateProtectionReadiness(
    { ...FULL_CAPABILITY, botCanManageRoles: false },
    { type: "role", rolePosition: 1, rolesBelow: [], rolesAbove: [] }
  );

  assert.equal(verdict.preventable, false);
  assert.match(verdict.reasons.join(" "), /Manage Roles/);
});

test("adaugarea salveaza snapshot-ul, iar a doua adaugare nu il suprascrie", async () => {
  const model = store();
  const repository = createProtectedResourceRepository(model);
  const input = {
    guildId: "g1", resourceId: "c1", type: "channel" as const, addedBy: "owner-1",
    snapshot: captureSnapshot(channelLike()), degraded: false, degradedReasons: [], preventionApplied: true
  };

  assert.equal((await repository.add(input)).kind, "added");
  const second = await repository.add({ ...input, snapshot: captureSnapshot(channelLike({ name: "redenumit" })) });

  assert.equal(second.kind, "already-protected");
  assert.equal(model.records.length, 1);
  const stored = await repository.read("g1", "c1");
  assert.equal(stored?.snapshot.name, "anunturi", "o a doua adaugare nu are voie sa inlocuiasca snapshot-ul original");
});

test("scoaterea din protectie nu sterge resursa si e idempotenta", async () => {
  const model = store();
  const repository = createProtectedResourceRepository(model);
  await repository.add({
    guildId: "g1", resourceId: "c1", type: "channel", addedBy: "owner-1",
    snapshot: emptySnapshot(), degraded: false, degradedReasons: [], preventionApplied: true
  });

  assert.equal(await repository.remove("g1", "c1"), true);
  assert.equal(await repository.remove("g1", "c1"), false);
  assert.equal(model.records.length, 0);
});

test("resursele a doua servere nu se amesteca", async () => {
  const model = store();
  const repository = createProtectedResourceRepository(model);
  const base = { type: "channel" as const, addedBy: "o", snapshot: emptySnapshot(), degraded: false, degradedReasons: [], preventionApplied: true };
  await repository.add({ ...base, guildId: "g1", resourceId: "c1" });
  await repository.add({ ...base, guildId: "g2", resourceId: "c1" });

  assert.equal((await repository.list("g1")).length, 1);
  assert.equal(await repository.read("g2", "c1") !== null, true);
  await repository.remove("g1", "c1");
  assert.equal(await repository.read("g2", "c1") !== null, true, "acelasi ID de resursa pe alt server ramane protejat");
});

test("recrearea leaga inregistrarea de ID-ul nou si pastreaza snapshot-ul", async () => {
  const model = store();
  const repository = createProtectedResourceRepository(model);
  await repository.add({
    guildId: "g1", resourceId: "vechi", type: "role", addedBy: "owner-1",
    snapshot: captureSnapshot(channelLike({ name: "Moderator" })), degraded: false, degradedReasons: [], preventionApplied: true
  });

  const rebound = await repository.rebind("g1", "vechi", "nou");

  assert.equal(rebound?.resourceId, "nou");
  assert.equal(rebound?.recreatedFromId, "vechi", "resursa recreata primeste ID nou; legatura cu cea veche ramane vizibila");
  assert.equal(rebound?.snapshot.name, "Moderator");
  assert.equal(await repository.read("g1", "vechi"), null);
});

test("limita de resurse protejate este respectata", async () => {
  const model = store();
  const repository = createProtectedResourceRepository(model);
  const base = { guildId: "g1", type: "channel" as const, addedBy: "o", snapshot: emptySnapshot(), degraded: false, degradedReasons: [], preventionApplied: true };
  for (let index = 0; index < PROTECTED_RESOURCE_LIMIT; index += 1) {
    assert.equal((await repository.add({ ...base, resourceId: `c${index}` })).kind, "added");
  }

  const overflow = await repository.add({ ...base, resourceId: "peste-limita" });

  assert.equal(overflow.kind, "limit-reached");
  assert.equal(model.records.length, PROTECTED_RESOURCE_LIMIT);
});

test("lista arata intai resursele degraded, cu numarul lor in antet", () => {
  const record = (id: string, degraded: boolean): ProtectedResourceRecord => ({
    _id: `g1:${id}`, guildId: "g1", resourceId: id, type: "channel", addedBy: "o",
    addedAt: new Date("2026-08-01T00:00:00.000Z"), snapshot: { ...emptySnapshot(), name: id },
    snapshotAt: new Date("2026-08-01T00:00:00.000Z"), degraded,
    degradedReasons: degraded ? ["Rolurile cu Administrator ignora overwrite-urile."] : [],
    preventionApplied: !degraded, lastRestoredAt: null, recreatedFromId: null
  });

  const lines = protectedResourceLines([record("bun", false), record("stricat", true)]);

  assert.match(lines[0], /1 degraded/);
  assert.match(lines[1], /stricat/, "resursele degraded apar primele, ca ownerul sa le vada fara sa caute");
  assert.equal(protectedResourceLines([]).length, 0);
});
