import test from "node:test";
import assert from "node:assert/strict";

import attachPermissionRequestHandler from "../../features/command-handlers/permissionRequestInteractionHandler.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { parseDurationMs, restrictionFromModal } from "../../features/command-security/permissionRequestApproval.js";
import { moduleContext } from "../moduleContextStub.js";
import type { PermissionRequestRecord } from "../../features/command-security/permissionRequestTypes.js";

type Doc = Record<string, unknown>;

function store(records: Doc[] = []) {
  function matches(record: Doc, filter: Doc): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      const actual = record[key];
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        const clause = expected as Doc;
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
    findOne(filter: Doc) {
      const found = records.find(record => matches(record, filter)) ?? null;
      return { lean: async (): Promise<Doc | null> => (found ? { ...found } : null) };
    },
    find(filter: Doc) {
      const found = records.filter(record => matches(record, filter));
      return { sort: () => ({ limit: () => ({ lean: async (): Promise<Doc[]> => found.map(record => ({ ...record })) }) }) };
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
    async updateMany(filter: Doc, update: Doc) {
      for (const record of records.filter(entry => matches(entry, filter))) Object.assign(record, update.$set);
      return undefined;
    }
  };
}

function interaction(overrides: Doc = {}) {
  const replies: Doc[] = [];
  const base = {
    replies,
    guild: { id: "g1", ownerId: "owner-1", channels: { fetch: async () => ({ send: async () => undefined }) }, members: { fetch: async () => null } },
    user: { id: "u1" },
    isChatInputCommand: () => true,
    isButton: () => false,
    commandName: "permission-request",
    reply: async (payload: Doc) => { replies.push(payload); return undefined; },
    update: async (payload: Doc) => { replies.push(payload); return undefined; },
    options: {
      getString: (name: string) => (overrides.strings as Record<string, string> | undefined)?.[name] ?? null,
      getInteger: (name: string) => (overrides.integers as Record<string, number> | undefined)?.[name] ?? null
    }
  };
  return { ...base, ...overrides, replies };
}

function handlerFor(model: ReturnType<typeof store>, settings: Doc = { permissionRequestChannelId: "c1" }) {
  return attachPermissionRequestHandler.buildCommandHandler(moduleContext<Parameters<typeof attachPermissionRequestHandler.buildCommandHandler>[0]>({
    PermissionRequestModel: model,
    getGuildSettings: async () => settings
  }));
}

test("/permission-request refuza un tip necunoscut inainte sa scrie ceva", async () => {
  const model = store();
  const handler = handlerFor(model);
  const call = interaction({ strings: { type: "orice", target: "x", action: "y", reason: "z" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /nu este valid/);
  assert.equal(model.records.length, 0, "o cerere cu tip invalid nu ajunge in colectie");
});

test("/permission-request cere ID de bot valid pentru bot-add", async () => {
  const model = store();
  const handler = handlerFor(model);
  const call = interaction({ strings: { type: "bot-add", target: "nu-e-id", action: "add", reason: "bot" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /17-20 cifre/);
  assert.equal(model.records.length, 0);
});

test("/permission-request refuza cand canalul de aprobare nu e configurat", async () => {
  const model = store();
  const handler = handlerFor(model, { permissionRequestChannelId: null });
  const call = interaction({ strings: { type: "webhook", target: "canal", action: "create", reason: "integrare" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /nu este configurat/);
  assert.equal(model.records.length, 0, "fara canal, cererea nu se salveaza degeaba");
});

test("/permission-request salveaza cererea si o trimite in canalul configurat", async () => {
  const model = store();
  const sent: Doc[] = [];
  const handler = handlerFor(model);
  const call = interaction({
    strings: { type: "webhook", target: "canal-1", action: "create", reason: "integrare RSS" },
    guild: {
      id: "g1", ownerId: "owner-1",
      channels: { fetch: async () => ({ send: async (payload: Doc) => { sent.push(payload); return undefined; } }) },
      members: { fetch: async () => null }
    }
  });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.equal(model.records.length, 1);
  assert.equal(model.records[0].type, "webhook");
  assert.equal(model.records[0].status, "pending");
  assert.ok(sent[0]?.components, "mesajul poarta butoanele Aproba/Respinge");
  assert.match(String(call.replies[0]?.content), /trimisa proprietarului/);
});

test("un non-owner nu poate decide o cerere", async () => {
  const model = store();
  const repository = createPermissionRequestRepository(model);
  await repository.create({ requestId: "r1", guildId: "g1", type: "webhook", requesterId: "u1", target: "c", action: "create", reason: "x" });
  const handler = handlerFor(model);
  const call = interaction({ isButton: () => true, customId: "permission-request:approve:r1", user: { id: "alt-user" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /Doar proprietarul/);
  assert.equal(model.records[0].status, "pending", "cererea ramane neatinsa");
});

test("respingerea de catre owner marcheaza cererea si nu lasa butoanele active", async () => {
  const model = store();
  const repository = createPermissionRequestRepository(model);
  await repository.create({ requestId: "r2", guildId: "g1", type: "webhook", requesterId: "u1", target: "c", action: "create", reason: "x" });
  const handler = handlerFor(model);
  const call = interaction({ isButton: () => true, customId: "permission-request:reject:r2", user: { id: "owner-1" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.equal(model.records[0].status, "rejected");
  assert.deepEqual(call.replies[0]?.components, [], "butoanele dispar dupa decizie");
  assert.match(String(call.replies[0]?.content), /Respinsa/);
});

test("/permission-requests list e vizibila doar ownerului", async () => {
  const model = store();
  const handler = handlerFor(model);
  const call = interaction({ commandName: "permission-requests", user: { id: "alt-user" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /Doar proprietarul/);
});

test("restrangerea din formular nu poate largi cererea initiala", () => {
  const record = {
    _id: "r", guildId: "g1", type: "permission-grant" as const, requesterId: "u1", reason: "",
    status: "pending" as const, requestedAt: new Date(), target: "rol-1", action: "grant",
    amount: 3, permissions: ["BanMembers"]
  } satisfies PermissionRequestRecord;

  const widened = restrictionFromModal(record, { target: "rol-1", action: "grant", amount: "10", permissions: "Administrator, BanMembers" });

  assert.equal(widened.amount, 3, "ownerul poate scadea cantitatea, nu o poate mari peste cea ceruta");
  assert.deepEqual(widened.permissions, ["BanMembers"], "o permisiune necereruta nu poate fi adaugata la aprobare");
});

test("durata ceruta e parsata si plafonata", () => {
  assert.equal(parseDurationMs("30m"), 30 * 60_000);
  assert.equal(parseDurationMs("2h"), 2 * 3_600_000);
  assert.equal(parseDurationMs("400d"), 30 * 24 * 60 * 60 * 1000, "o durata absurda e plafonata la 30 de zile");
  assert.equal(parseDurationMs("maine"), null);
});
