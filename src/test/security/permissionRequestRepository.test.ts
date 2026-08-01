import test from "node:test";
import assert from "node:assert/strict";

import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { scopeMatchesApproval, stripInapplicableFields } from "../../features/command-security/permissionRequestTypes.js";
import type { PermissionRequestRecord } from "../../features/command-security/permissionRequestTypes.js";

function collection(records: PermissionRequestRecord[] = []) {
  function matches(record: PermissionRequestRecord, filter: Record<string, unknown>): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      const actual = ({ ...record } as Record<string, unknown>)[key];
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        const clause = expected as Record<string, unknown>;
        if ("$in" in clause && !(clause.$in as unknown[]).includes(actual)) return false;
        if ("$gt" in clause && !(actual instanceof Date && actual.getTime() > (clause.$gt as Date).getTime())) return false;
        if ("$lte" in clause && !(actual instanceof Date && actual.getTime() <= (clause.$lte as Date).getTime())) return false;
        continue;
      }
      if (actual !== expected) return false;
    }
    return true;
  }

  return {
    records,
    findOne(filter: Record<string, unknown>) {
      return { lean: async () => records.find(record => matches(record, filter)) ?? null };
    },
    find(filter: Record<string, unknown>) {
      const found = records.filter(record => matches(record, filter));
      return { sort: () => ({ limit: () => ({ lean: async () => found }) }) };
    },
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) {
      const existing = records.find(record => matches(record, filter));
      if (!existing) {
        if (options?.upsert && update.$setOnInsert) {
          records.push(update.$setOnInsert as PermissionRequestRecord);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (update.$set) Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
      for (const record of records.filter(entry => matches(entry, filter))) {
        Object.assign(record, update.$set);
      }
      return undefined;
    }
  };
}

const AT = new Date("2026-08-01T10:00:00.000Z");

test("o cerere se creeaza o singura data, chiar daca acelasi id vine de doua ori", async () => {
  const store = collection();
  const repository = createPermissionRequestRepository(store);
  const input = {
    requestId: "r1", guildId: "g1", type: "bot-add" as const, requesterId: "u1",
    target: "b1", action: "add", botId: "b1", reason: "bot de muzica"
  };

  const first = await repository.create(input, AT);
  const second = await repository.create(input, AT);

  assert.ok(first, "prima creare reuseste");
  assert.equal(second, null, "a doua nu mai creeaza o cerere paralela pentru acelasi id");
  assert.equal(store.records.length, 1);
});

test("campurile care nu se aplica tipului sunt scoase, nu salvate degeaba", () => {
  const scope = { target: "b1", action: "add", amount: 12, permissions: ["Administrator"], botId: "b1" };
  const kept = stripInapplicableFields("bot-add", scope);
  assert.deepEqual(kept, { target: "b1", action: "add", botId: "b1" });
  assert.equal("amount" in kept, false, "bot-add nu are cantitate");
  assert.equal("permissions" in kept, false, "bot-add nu acorda permisiuni");
});

test("aprobarea poate restrange cererea, iar valorile restranse sunt cele care conteaza la consum", async () => {
  const store = collection();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "r2", guildId: "g1", type: "permission-grant", requesterId: "u1",
    target: "role-1", action: "grant", permissions: ["Administrator", "BanMembers"], reason: "moderare"
  }, AT);

  const approved = await repository.resolve("g1", "r2", "approved", "owner-1", { permissions: ["BanMembers"] }, AT);
  assert.equal(approved?.status, "approved");
  assert.deepEqual(approved?.approvedPermissions, ["BanMembers"]);

  const tooWide = await repository.consume("g1", "permission-grant", "u1", {
    target: "role-1", action: "grant", permissions: ["Administrator"]
  }, AT);
  assert.equal(tooWide, null, "o permisiune peste ce a aprobat ownerul nu poate consuma aprobarea");

  const exact = await repository.consume("g1", "permission-grant", "u1", {
    target: "role-1", action: "grant", permissions: ["BanMembers"]
  }, AT);
  assert.equal(exact?.status, "used");
});

test("o aprobare se consuma o singura data", async () => {
  const store = collection();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "r3", guildId: "g1", type: "webhook", requesterId: "u1",
    target: "canal-1", action: "create", reason: "integrare"
  }, AT);
  await repository.resolve("g1", "r3", "approved", "owner-1", {}, AT);

  const attempt = { target: "canal-1", action: "create" };
  const first = await repository.consume("g1", "webhook", "u1", attempt, AT);
  const second = await repository.consume("g1", "webhook", "u1", attempt, AT);

  assert.equal(first?.status, "used");
  assert.equal(second, null, "a doua incercare nu mai gaseste aprobare activa");
});

test("aprobarea e legata de solicitant: alt utilizator nu o poate folosi", async () => {
  const store = collection();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "r4", guildId: "g1", type: "bot-add", requesterId: "u1",
    target: "b9", action: "add", botId: "b9", reason: "bot"
  }, AT);
  await repository.resolve("g1", "r4", "approved", "owner-1", {}, AT);

  const otherUser = await repository.consume("g1", "bot-add", "u2", { target: "b9", action: "add", botId: "b9" }, AT);
  assert.equal(otherUser, null, "aprobarea e valabila numai pentru combinatia solicitant + bot");
});

test("o cerere expirata nu mai poate fi aprobata", async () => {
  const store = collection();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "r5", guildId: "g1", type: "moderation-mass", requesterId: "u1",
    target: "membri", action: "ban", amount: 5, reason: "raid"
  }, AT);
  const later = new Date(AT.getTime() + 48 * 60 * 60 * 1000);

  const resolved = await repository.resolve("g1", "r5", "approved", "owner-1", {}, later);
  assert.equal(resolved, null);
  assert.equal(store.records[0].status, "expired", "cererea a fost marcata expirata inainte de decizie");
});

test("oprirea unui set de tipuri anuleaza doar cererile acelor tipuri", async () => {
  const store = collection();
  const repository = createPermissionRequestRepository(store);
  await repository.create({ requestId: "a", guildId: "g1", type: "webhook", requesterId: "u1", target: "c", action: "create", reason: "x" }, AT);
  await repository.create({ requestId: "b", guildId: "g1", type: "bot-add", requesterId: "u1", target: "b", action: "add", botId: "b", reason: "y" }, AT);

  await repository.cancelTypes("g1", ["webhook"]);

  assert.equal(store.records.find(record => record._id === "a")?.status, "cancelled");
  assert.equal(store.records.find(record => record._id === "b")?.status, "pending", "celelalte tipuri raman neatinse");
});

test("cantitatea aprobata e un plafon, nu o valoare exacta", () => {
  const record = {
    _id: "r", guildId: "g", type: "moderation-mass" as const, requesterId: "u", reason: "",
    status: "approved" as const, requestedAt: AT, target: "membri", action: "ban", approvedAmount: 3
  };
  assert.equal(scopeMatchesApproval(record, { target: "membri", action: "ban", amount: 3 }), true);
  assert.equal(scopeMatchesApproval(record, { target: "membri", action: "ban", amount: 4 }), false, "peste plafon nu e acoperit");
});
