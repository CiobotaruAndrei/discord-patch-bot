import test from "node:test";
import assert from "node:assert/strict";

import attachPermissionRequestHandler, { restrictionModal } from "../../features/command-handlers/permissionRequestInteractionHandler.js";
import { CLAIM_RECOVERY_MS, DELIVERY_FAILED_REASON, createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { RESTRICTION_INPUT_IDS, compareRequestedApproved, parseDurationMs, restrictionFromModal } from "../../features/command-security/permissionRequestApproval.js";
import { PERMISSION_REQUEST_TYPES } from "../../features/command-security/permissionRequestTypes.js";
import { calls, loadModule } from "../gates/sourceStructureQueries.js";
import { moduleContext } from "../moduleContextStub.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { requestedDurationLabel, validateRestrictionIsSubset } from "../../features/command-security/approvalSubsetPolicy.js";
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

test("o largire din formular ajunge la validare, nu e taiata tacut (review PR #998)", () => {
  const record = {
    _id: "r", guildId: "g1", type: "permission-grant" as const, requesterId: "u1", reason: "",
    status: "pending" as const, requestedAt: new Date(), target: "rol-1", action: "grant",
    amount: 3, permissions: ["BanMembers"]
  } satisfies PermissionRequestRecord;

  const widened = restrictionFromModal(record, { target: "rol-1", action: "grant", amount: "10", permissions: "Administrator, BanMembers" });

  assert.equal(widened.amount, 10, "clamparea tacuta ascundea largirea de verificarea de subset");
  assert.deepEqual(widened.permissions, ["Administrator", "BanMembers"]);

  const verdict = validateRestrictionIsSubset(record, widened);
  assert.equal(verdict.ok, false, "largirea se refuza explicit, cu mesaj pentru owner");
  assert.match(verdict.ok === false ? verdict.problem : "", /nu poate depasi cantitatea ceruta/);
});

test("filtrarea permisiunilor nu mai poate produce o aprobare goala (review PR #998)", () => {
  const record = {
    _id: "r", guildId: "g1", type: "permission-grant" as const, requesterId: "u1", reason: "",
    status: "pending" as const, requestedAt: new Date(), target: "rol-1", action: "grant",
    permissions: ["BanMembers"]
  } satisfies PermissionRequestRecord;

  const restriction = restrictionFromModal(record, { target: "rol-1", action: "grant", permissions: "Administrator" });

  assert.deepEqual(restriction.permissions, ["Administrator"],
    "inainte, filtrarea lasa un array gol si se persista o aprobare inutilizabila, anuntata ca reusita");
  assert.equal(validateRestrictionIsSubset(record, restriction).ok, false);
});

test("modalul propune durata ceruta, nu una fixa mai mare (review PR #998)", () => {
  const record = {
    _id: "r", guildId: "g1", type: "webhook" as const, requesterId: "u1", reason: "",
    status: "pending" as const, requestedAt: new Date(), target: "111111111111111111", action: "create",
    requestedTtlMs: 30 * 60 * 1000
  } satisfies PermissionRequestRecord;

  assert.equal(requestedDurationLabel(record), "30m",
    "cu `1h` fix, o aprobare nemodificata a unei cereri de 30m ar fi fost refuzata desi ownerul nu a editat nimic");

  const restriction = restrictionFromModal(record, { target: "111111111111111111", action: "create", duration: requestedDurationLabel(record) });
  assert.equal(validateRestrictionIsSubset(record, restriction).ok, true);
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

test("ownerul poate restrange si botul executor, nu doar tinta si permisiunile (F-08)", () => {
  const record: PermissionRequestRecord = {
    _id: "r1", guildId: "g1", type: "bot-add", requesterId: "u1",
    status: "pending", requestedAt: new Date(), target: "111111111111111111",
    action: "add", botId: "111111111111111111", reason: "integrare"
  };

  const restriction = restrictionFromModal(record, {
    target: "111111111111111111",
    action: "add",
    botId: "222222222222222222"
  });

  assert.equal(
    restriction.botId,
    "222222222222222222",
    "fara restrictie pe botul executor, aprobarea nu putea fi ingustata complet fara respingere si recreare"
  );
});

test("botul executor neschimbat nu produce o restrictie inutila (F-08)", () => {
  const record: PermissionRequestRecord = {
    _id: "r2", guildId: "g1", type: "bot-add", requesterId: "u1",
    status: "pending", requestedAt: new Date(), target: "111111111111111111",
    action: "add", botId: "111111111111111111", reason: "integrare"
  };

  const restriction = restrictionFromModal(record, { botId: "111111111111111111" });

  assert.equal(restriction.botId, undefined);
});

test("rezumatul compara cerut cu aprobat pe toate dimensiunile (F-08)", () => {
  const record: PermissionRequestRecord = {
    _id: "r3", guildId: "g1", type: "permission-grant", requesterId: "u1",
    status: "approved", requestedAt: new Date(), respondedAt: new Date(), ownerId: "owner-1",
    target: "111111111111111111", action: "grant", amount: 10,
    permissions: ["Ban Members", "Kick Members"], botId: "222222222222222222",
    approvedAmount: 3, approvedPermissions: ["Ban Members"], approvedBotId: "333333333333333333",
    reason: "moderare"
  };

  const summary = compareRequestedApproved(record);

  assert.match(summary, /restrans/);
  assert.match(summary, /cantitate: 10 -> 3/);
  assert.match(summary, /permisiuni: Ban Members, Kick Members -> Ban Members/);
  assert.match(summary, /bot executor: 222222222222222222 -> 333333333333333333/);
  assert.match(summary, /tinta: 111111111111111111 = 111111111111111111/, "dimensiunile neschimbate se vad ca neschimbate");
});

test("cand nimic nu s-a restrans, rezumatul o spune explicit (F-08)", () => {
  const record: PermissionRequestRecord = {
    _id: "r4", guildId: "g1", type: "webhook", requesterId: "u1",
    status: "approved", requestedAt: new Date(), respondedAt: new Date(), ownerId: "owner-1",
    target: "111111111111111111", action: "create", reason: "integrare"
  };

  assert.match(compareRequestedApproved(record), /neschimbat/);
});

test("modalul de aprobare nu depaseste niciodata cele cinci randuri permise de Discord (review PR #977)", () => {
  for (const type of PERMISSION_REQUEST_TYPES) {
    const record: PermissionRequestRecord = {
      _id: `r-${type}`, guildId: "g1", type, requesterId: "u1", status: "pending",
      requestedAt: new Date(), target: "111111111111111111", action: "add",
      amount: 5, permissions: ["Ban Members"], botId: "222222222222222222", reason: "test"
    };

    const modal = restrictionModal(record, "modal-1") as { components?: unknown[] };

    assert.ok(
      (modal.components?.length ?? 0) <= 5,
      `${type}: Discord respinge showModal peste cinci randuri, deci aprobarea ar fi devenit imposibila`
    );
    assert.ok((modal.components?.length ?? 0) >= 3, `${type}: tinta, actiunea si valabilitatea raman intotdeauna`);
  }
});

test("modalul arata campul de bot doar unde tipul il foloseste (review PR #977)", () => {
  const record: PermissionRequestRecord = {
    _id: "r-bot", guildId: "g1", type: "bot-add", requesterId: "u1", status: "pending",
    requestedAt: new Date(), target: "111111111111111111", action: "add",
    botId: "111111111111111111", reason: "integrare"
  };

  const modal = restrictionModal(record, "modal-2") as { components?: Array<{ components?: Array<{ custom_id?: string }> }> };
  const ids = (modal.components ?? []).flatMap(row => (row.components ?? []).map(field => field.custom_id));

  assert.ok(ids.includes(RESTRICTION_INPUT_IDS.botId), "bot-add chiar foloseste botul executor");
  assert.ok(!ids.includes(RESTRICTION_INPUT_IDS.permissions), "permisiunile nu se aplica la bot-add, deci nu ocupa un rand");
});

test("raspunsul dupa aprobare chiar include rezumatul cerut-vs-aprobat (review PR #977)", async () => {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-rezumat", guildId: "g1", type: "moderation-mass", requesterId: "u1",
    target: "111111111111111111", action: "ban", amount: 10, reason: "curatenie"
  });

  const handler = handlerFor(model);
  const call = interaction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: "permission-request:approve:req-rezumat",
    user: { id: "owner-1" }
  });

  await handler.handle(
    moduleContext<Parameters<typeof handler.handle>[0]>(call),
    moduleContext<Parameters<typeof handler.handle>[1]>({})
  );

  const content = String(call.replies[0]?.content ?? "");
  assert.match(content, /Cerut -> aprobat/, "helperul era chemat, dar rezultatul nu ajungea in mesajul catre owner");
  assert.match(content, /cantitate: 10/);
});

async function approveWithModal(model: ReturnType<typeof permissionRequestStore>, fields: Record<string, string>) {
  const handler = handlerFor(model);
  const replies: Array<{ content?: string }> = [];
  const updates: Array<{ content?: string }> = [];

  const call = moduleContext<Parameters<typeof handler.handle>[0]>({
    isButton: () => true,
    customId: "permission-request:approve:req-1",
    guild: { id: "g1", ownerId: "owner-1", members: { fetch: async () => null } },
    user: { id: "owner-1" },
    showModal: async () => undefined,
    awaitModalSubmit: async () => ({
      customId: "modal",
      user: { id: "owner-1" },
      fields: { getTextInputValue: (id: string) => fields[id] ?? "" },
      reply: async (payload: { content: string }) => { replies.push(payload); }
    }),
    update: async (payload: { content?: string }) => { updates.push(payload); },
    reply: async (payload: { content?: string }) => { replies.push(payload); }
  });

  await handler.handle(call, moduleContext<Parameters<typeof handler.handle>[1]>({}));
  return { replies, updates };
}

test("o restrictie care schimba tinta e refuzata inainte de a fi persistata (F-08)", async () => {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "webhook", requesterId: "u1",
    target: "111111111111111111", action: "create", reason: "integrare"
  });

  const outcome = await approveWithModal(model, {
    [RESTRICTION_INPUT_IDS.target]: "222222222222222222",
    [RESTRICTION_INPUT_IDS.action]: "create"
  });

  assert.match(String(outcome.replies[0]?.content ?? ""), /Tinta nu poate fi schimbata/);
  assert.equal(model.records[0].status, "pending",
    "cererea ramane in asteptare: o restrictie invalida nu are voie sa devina aprobare");
});

test("o restrictie valida se aplica in continuare (F-08)", async () => {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "moderation-mass", requesterId: "u1",
    target: "111111111111111111", action: "ban", amount: 5, reason: "curatare"
  });

  await approveWithModal(model, {
    [RESTRICTION_INPUT_IDS.target]: "111111111111111111",
    [RESTRICTION_INPUT_IDS.action]: "ban",
    [RESTRICTION_INPUT_IDS.amount]: "2"
  });

  assert.equal(model.records[0].status, "approved");
  assert.equal(model.records[0].approvedAmount, 2, "ingustarea reala ramane posibila");
});
