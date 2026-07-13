import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult, applyDedupeMarker, isDeliverableOutboxPayload, messageHasDedupeMarker, outboxDedupeMarker } from "../../features/notifications/notificationOutbox.js";
import { makeFakeModel, makeRuntime, makeSweepRuntime, type OutboxModelMock, type OutboxSentModelMock } from "../outboxTestKit.js";

test("enqueueOutbox creeaza un job cu attempts 0, createdAt si availableAt", async () => {
  const { runtime, created } = makeRuntime([]);
  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { embeds: [] } });
  assert.equal(created.length, 1);
  assert.equal(created[0].guildId, "g1");
  assert.equal(created[0].kind, "update");
  assert.equal(created[0].attempts, 0);
  assert.ok(created[0].availableAt instanceof Date);
  assert.ok(created[0].createdAt instanceof Date);
  assert.equal(typeof created[0].dedupeKey, "string", "jobul primeste un dedupeKey stabil");
  assert.match(String(created[0].dedupeKey), /^[0-9a-f]{64}$/, "dedupeKey este un hash SHA-256 (64 hex)");
});

test("enqueueOutbox: dedupeKey e stabil indiferent de ordinea cheilor din payload", async () => {
  const a = makeRuntime([]);
  await a.runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1, y: { p: 2, q: 3 } } });
  const b = makeRuntime([]);
  await b.runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { y: { q: 3, p: 2 }, x: 1 } });
  assert.equal(a.created[0].dedupeKey, b.created[0].dedupeKey, "normalizare stabila -> acelasi dedupeKey la chei reordonate");
});

test("enqueueOutbox: nu re-enqueue daca dedupeKey a fost livrat recent (idempotent)", async () => {
  const probe = makeRuntime([]);
  const dedupeKey = (await (async () => {
    await probe.runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } });
    return String(probe.created[0].dedupeKey);
  })());
  const { runtime, created } = makeRuntime([], [dedupeKey]);
  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } });
  assert.equal(created.length, 0, "acelasi continut deja livrat -> nu se mai creeaza job");
});

test("enqueueOutbox: indexul unique pe dedupeKey previne duplicatul in-flight la re-enqueue (replay idempotent, R #5)", async () => {
  const { runtime, created } = makeRuntime([], [], true);
  const job = { guildId: "g1", channelId: "c1", kind: "update" as const, payload: { x: 1 } };
  await runtime.enqueueOutbox(job);
  await runtime.enqueueOutbox(job);
  assert.equal(created.length, 1, "al doilea enqueue cu acelasi continut, cat primul e inca in coada (nelivrat), e respins de indexul unique (11000) -> niciun duplicat, replay-ul e idempotent");
});

test("applyDedupeMarker: adauga un marker dedupeKey in footer-ul ultimului embed (idempotent)", () => {
  const payload = { embeds: [{ title: "A" }, { title: "B", footer: { text: "deal" } }] };
  const dedupeKey = "abcdef0123456789ffff";
  const marked = applyDedupeMarker(payload, dedupeKey) as { embeds: Array<{ footer?: { text?: string } }> };
  const marker = outboxDedupeMarker(dedupeKey);
  assert.ok(marked.embeds[1].footer?.text?.includes(marker), "marker pus in footer-ul ultimului embed");
  assert.ok(marked.embeds[1].footer?.text?.includes("deal"), "footer-ul existent e pastrat");
  assert.equal(marked.embeds[0].footer, undefined, "embed-urile anterioare raman neatinse");
  const again = applyDedupeMarker(marked, dedupeKey) as { embeds: Array<{ footer?: { text?: string } }> };
  const count = (again.embeds[1].footer?.text?.match(/id:/g) || []).length;
  assert.equal(count, 1, "nu dubleaza marker-ul daca e deja prezent");
});

test("applyDedupeMarker: payload fara embeds ramane neschimbat", () => {
  const payload = { content: "salut" };
  assert.deepEqual(applyDedupeMarker(payload, "k"), payload);
});

test("messageHasDedupeMarker: detecteaza marker-ul intr-un mesaj postat", () => {
  const dedupeKey = "abcdef0123456789ffff";
  const marker = outboxDedupeMarker(dedupeKey);
  const message = { embeds: [{ footer: { text: `deal · ${marker}` } }] };
  assert.equal(messageHasDedupeMarker(message, marker), true);
  assert.equal(messageHasDedupeMarker({ embeds: [{ footer: { text: "altceva" } }] }, marker), false);
  assert.equal(messageHasDedupeMarker({}, marker), false);
});

test("drainOutbox: livrarea reusita inregistreaza dedupeKey in istoricul de trimiteri", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" };
  const { runtime, deleted, sentKeys } = makeRuntime([job]);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1);
  assert.ok(sentKeys.has("k1"), "dedupeKey marcat ca trimis inainte de stergerea jobului");
  assert.deepEqual(deleted, [{ _id: "j1" }]);
});

test("drainOutbox: job cu dedupeKey deja in istoric -> nu re-trimite (recovery dupa crash)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" };
  const { runtime, deleted } = makeRuntime([job], ["k1"]);
  let delivered = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(delivered, 0, "nu se re-trimite ce e deja in istoricul de livrari");
  assert.equal(result.sent, 0);
  assert.deepEqual(deleted, [{ _id: "j1" }], "jobul ramas dupa crash e curatat fara re-trimitere");
});

test("enqueueOutbox: eroarea de cheie duplicata (E11000) e ignorata (job pending identic exista deja)", async () => {
  let createCalls = 0;
  const model: OutboxModelMock = {
    create: async () => { createCalls++; throw Object.assign(new Error("dup key"), { code: 11000 }); },
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 0 }),
    countDocuments: async () => 0
  };
  const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  await assert.doesNotReject(
    () => runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } }),
    "enqueue cu dedupeKey deja in coada nu trebuie sa arunce"
  );
  assert.equal(createCalls, 1, "s-a incercat o singura creare");
});

test("enqueueOutbox: alte erori la create se propaga (nu sunt inghitite)", async () => {
  const model: OutboxModelMock = {
    create: async () => { throw new Error("conexiune pierduta"); },
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 0 }),
    countDocuments: async () => 0
  };
  const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  await assert.rejects(
    () => runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } }),
    /conexiune pierduta/,
    "o eroare care nu e E11000 trebuie sa se propage"
  );
});

test("isDeliverableOutboxPayload valideaza structural payload-ul (obiect simplu), fara reguli de business Discord (validate step) (R[Arh] #5)", () => {
  assert.equal(isDeliverableOutboxPayload({ content: "salut" }), true);
  assert.equal(isDeliverableOutboxPayload({ embeds: [{ title: "t" }] }), true);
  assert.equal(isDeliverableOutboxPayload({}), true, "obiect gol ramane treaba lui deliver (Discord decide), nu a cozii");
  assert.equal(isDeliverableOutboxPayload({ embeds: [] }), true);
  assert.equal(isDeliverableOutboxPayload(null), false);
  assert.equal(isDeliverableOutboxPayload(undefined), false);
  assert.equal(isDeliverableOutboxPayload("text-corupt"), false, "un payload serializat gresit (string) nu poate fi trimis niciodata");
  assert.equal(isDeliverableOutboxPayload(42), false);
  assert.equal(isDeliverableOutboxPayload([{ content: "x" }]), false, "array-ul e semn de corupte la replay/serializare");
});

test("enqueueOutbox refuza payload-urile nelivrabile (corupte la serializare) inainte sa intre in coada (R6 #8)", async () => {
  const { runtime, created } = makeRuntime([]);
  const corruptPayloads: unknown[] = ["text-corupt", 42, null, [{ content: "x" }]];
  for (const payload of corruptPayloads) {
    await assert.rejects(
      () => runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "youtube", payload: payload as import("../../features/notifications/outboxTypes.js").OutboxMessagePayload }),
      /nelivrabil/,
      `payload-ul ${JSON.stringify(payload)} trebuie refuzat la enqueue`
    );
  }
  assert.equal(created.length, 0, "niciun job corupt nu a intrat in coada");
  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "youtube", payload: { content: "ok" } });
  assert.equal(created.length, 1, "payload-ul valid trece de validare");
});
