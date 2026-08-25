import test from "node:test";
import assert from "node:assert/strict";

import attachPermissionRequestHandler from "../../features/command-handlers/permissionRequestInteractionHandler.js";
import { CLAIM_RECOVERY_MS, DELIVERY_FAILED_REASON, createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { calls, loadModule } from "../gates/sourceStructureQueries.js";
import { parseDurationMs, restrictionFromModal } from "../../features/command-security/permissionRequestApproval.js";
import { moduleContext } from "../moduleContextStub.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import type { PermissionRequestRecord } from "../../features/command-security/permissionRequestTypes.js";

function interaction(overrides: Record<string, unknown> = {}) {
  const replies: Record<string, unknown>[] = [];
  const base = {
    replies,
    guild: { id: "g1", ownerId: "owner-1", channels: { fetch: async () => ({ send: async () => undefined }) }, members: { fetch: async () => null } },
    user: { id: "u1" },
    isChatInputCommand: () => true,
    isButton: () => false,
    commandName: "permission-request",
    reply: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    update: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    options: {
      getString: (name: string) => (overrides.strings as Record<string, string> | undefined)?.[name] ?? null,
      getInteger: (name: string) => (overrides.integers as Record<string, number> | undefined)?.[name] ?? null
    }
  };
  return { ...base, ...overrides, replies };
}

function handlerFor(model: ReturnType<typeof permissionRequestStore>, settings: Record<string, unknown> = { permissionRequestChannelId: "c1" }) {
  return attachPermissionRequestHandler.buildCommandHandler(moduleContext<Parameters<typeof attachPermissionRequestHandler.buildCommandHandler>[0]>({
    PermissionRequestModel: model,
    getGuildSettings: async () => settings
  }));
}

test("/permission-request refuza un tip necunoscut inainte sa scrie ceva", async () => {
  const model = permissionRequestStore();
  const handler = handlerFor(model);
  const call = interaction({ strings: { type: "orice", target: "x", action: "y", reason: "z" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /nu este valid/);
  assert.equal(model.records.length, 0, "o cerere cu tip invalid nu ajunge in colectie");
});

test("/permission-request cere ID de bot valid pentru bot-add", async () => {
  const model = permissionRequestStore();
  const handler = handlerFor(model);
  const call = interaction({ strings: { type: "bot-add", target: "nu-e-id", action: "add", reason: "bot" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /17-20 cifre/);
  assert.equal(model.records.length, 0);
});

test("/permission-request refuza cand canalul de aprobare nu e configurat", async () => {
  const model = permissionRequestStore();
  const handler = handlerFor(model, { permissionRequestChannelId: null });
  const call = interaction({ strings: { type: "webhook", target: "111111111111111111", action: "create", reason: "integrare" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /nu este configurat/);
  assert.equal(model.records.length, 0, "fara canal, cererea nu se salveaza degeaba");
});

test("/permission-request salveaza cererea si o trimite in canalul configurat", async () => {
  const model = permissionRequestStore();
  const sent: Record<string, unknown>[] = [];
  const handler = handlerFor(model);
  const call = interaction({
    strings: { type: "webhook", target: "111111111111111111", action: "create", reason: "integrare RSS" },
    guild: {
      id: "g1", ownerId: "owner-1",
      channels: { fetch: async () => ({ send: async (payload: Record<string, unknown>) => { sent.push(payload); return undefined; } }) },
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
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({ requestId: "r1", guildId: "g1", type: "webhook", requesterId: "u1", target: "c", action: "create", reason: "x" });
  const handler = handlerFor(model);
  const call = interaction({ isButton: () => true, customId: "permission-request:approve:r1", user: { id: "alt-user" } });

  await handler.handle(moduleContext<Parameters<typeof handler.handle>[0]>(call), moduleContext<Parameters<typeof handler.handle>[1]>({}));

  assert.match(String(call.replies[0]?.content), /Doar proprietarul/);
  assert.equal(model.records[0].status, "pending", "cererea ramane neatinsa");
});

test("respingerea de catre owner marcheaza cererea si nu lasa butoanele active", async () => {
  const model = permissionRequestStore();
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
  const model = permissionRequestStore();
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

test("cand consumul unei actiuni ulterioare arunca, aprobarile deja consumate revin in starea aprobat (review PR #949)", async () => {
  const store = permissionRequestStore();
  const repository = createPermissionRequestRepository(store);
  for (const [id, action] of [["req-a", "rename"], ["req-b", "move"]] as const) {
    await repository.create({
      requestId: id, guildId: "g1", type: "protected-resource-change",
      requesterId: "mod-1", target: "111111111111111111", action, reason: "curatenie"
    });
    await repository.resolve("g1", id, "approved", "owner-1", {});
  }

  let claims = 0;
  const flaky = {
    ...store,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
      const set = update.$set as Record<string, unknown> | undefined;
      if (set?.status === "used") {
        claims += 1;
        if (claims === 2) throw new Error("Mongo indisponibil");
      }
      return store.updateOne(filter, update, options);
    }
  };

  const claimed = await createPermissionRequestRepository(flaky).consumeAll(
    "g1",
    "protected-resource-change",
    "mod-1",
    [{ target: "111111111111111111", action: "rename" }, { target: "111111111111111111", action: "move" }]
  );

  assert.equal(claimed, null, "un consum partial nu poate raporta succes");
  assert.equal((await repository.read("g1", "req-a"))?.status, "approved",
    "aprobarea deja consumata nu ramane arsa cand restul setului esueaza");
});

test("o revendicare ramasa neconfirmata dupa o cadere de proces revine singura la aprobat (review PR #950)", async () => {
  const store = permissionRequestStore();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "req-c", guildId: "g1", type: "protected-resource-change",
    requesterId: "mod-1", target: "111111111111111111", action: "rename", reason: "curatenie"
  });
  await repository.resolve("g1", "req-c", "approved", "owner-1", {});

  const stranded = store.records.find(record => record._id === "req-c");
  assert.ok(stranded);
  Object.assign(stranded, {
    status: "used",
    usedAt: new Date(Date.now() - CLAIM_RECOVERY_MS - 1000),
    claimBatchId: "g1:1:1"
  });

  await repository.expireStale("g1", new Date());

  const recovered = await repository.read("g1", "req-c");
  assert.equal(recovered?.status, "approved", "o aprobare blocata in used de o cadere de proces nu ramane arsa pentru totdeauna");
  assert.equal(recovered?.claimBatchId ?? null, null);
});

test("o cerere nelivrata e anulata, nu respinsa in numele unui owner gol (F-09)", async () => {
  const store = permissionRequestStore();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "req-nelivrat", guildId: "g1", type: "webhook", requesterId: "u1",
    target: "111111111111111111", action: "create", reason: "integrare"
  });

  const cancelled = await repository.cancelUndelivered("g1", "req-nelivrat");
  const record = await repository.read("g1", "req-nelivrat");

  assert.equal(cancelled, true);
  assert.equal(record?.status, "cancelled", "un esec tehnic de livrare nu e o decizie a ownerului");
  assert.equal(record?.cancelReason, DELIVERY_FAILED_REASON);
  assert.notEqual(record?.status, "rejected");
});

test("anularea nu atinge o cerere deja decisa (F-09)", async () => {
  const store = permissionRequestStore();
  const repository = createPermissionRequestRepository(store);
  await repository.create({
    requestId: "req-decis", guildId: "g1", type: "webhook", requesterId: "u1",
    target: "111111111111111111", action: "create", reason: "integrare"
  });
  await repository.resolve("g1", "req-decis", "approved", "owner-1", {});

  const cancelled = await repository.cancelUndelivered("g1", "req-decis");

  assert.equal(cancelled, false, "anularea e atomica: prinde doar cererile inca in asteptare");
  assert.equal((await repository.read("g1", "req-decis"))?.status, "approved");
});

test("handlerul foloseste anularea, nu respingerea, la esecul livrarii (F-09)", () => {
  const handler = loadModule("features", "command-handlers", "permissionRequestInteractionHandler.ts");
  const used = new Set(calls(handler).map(call => call.callee));

  assert.ok(used.has("repository.cancelUndelivered"), "istoricul nu are voie sa arate o respingere cu owner gol");
});
