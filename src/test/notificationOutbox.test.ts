import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult, applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker } from "../features/notifications/notificationOutbox";

function makeFakeModel(jobs: OutboxJob[], initialSent: string[] = []) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const updated: Array<{ filter: unknown; update: unknown }> = [];
  const claims: Array<{ filter: unknown; update: unknown }> = [];
  const sentKeys = new Set<string>(initialSent);
  const pending = [...jobs];
  const model = {
    create: async (doc: Record<string, unknown>) => { created.push(doc); return doc; },
    findOneAndUpdate: async (filter: unknown, update: unknown) => {
      claims.push({ filter, update });
      return pending.shift() ?? null;
    },
    find: (_filter: unknown) => ({
      sort: (_spec: unknown) => ({
        limit: (_count: number) => ({
          lean: async () => jobs.slice(0, 1)
        })
      })
    }),
    deleteOne: async (filter: unknown) => { deleted.push(filter); return { deletedCount: 1 }; },
    updateOne: async (filter: unknown, update: unknown) => { updated.push({ filter, update }); return { matchedCount: 1 }; },
    countDocuments: async () => jobs.length - deleted.length
  };
  const sentModel = {
    exists: async (filter: { dedupeKey: string }) => (sentKeys.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sentKeys.add(filter.dedupeKey); return { upsertedCount: 1 }; }
  };
  return { model, sentModel, created, deleted, updated, claims, sentKeys };
}

function makeRuntime(jobs: OutboxJob[], initialSent: string[] = []) {
  const fake = makeFakeModel(jobs, initialSent);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model as never,
    NotificationOutboxSentModel: fake.sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  return { runtime, ...fake };
}

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

test("drainOutbox: claim atomic prin lease (lockedUntil/lockedBy) inainte de livrare", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, claims } = makeRuntime([job]);
  await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, workerId: "worker-7"
  });
  assert.ok(claims.length >= 1, "jobul este revendicat printr-un findOneAndUpdate");
  const claimUpdate = claims[0].update as { $set: { lockedUntil: Date; lockedBy: string }; $inc: { deliveries: number } };
  assert.ok(claimUpdate.$set.lockedUntil instanceof Date, "lease seteaza lockedUntil");
  assert.equal(claimUpdate.$set.lockedBy, "worker-7", "lease seteaza lockedBy");
  assert.equal(claimUpdate.$inc.deliveries, 1, "claim-ul incrementeaza contorul de livrari (detectie recovery)");
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

test("drainOutbox: livrare reusita -> jobul e sters (sent)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, deleted, updated } = makeRuntime([job]);
  const deadLetters: unknown[] = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (j) => { deadLetters.push(j); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1);
  assert.equal(result.deadLettered, 0);
  assert.equal(result.retried, 0);
  assert.equal(result.total, 1);
  assert.equal(result.queued, 0);
  assert.ok(typeof result.deliveryMsTotal === "number" && result.deliveryMsTotal >= 0);
  assert.ok(typeof result.oldestJobAgeMs === "number" && result.oldestJobAgeMs >= 0);
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(updated.length, 0);
  assert.equal(deadLetters.length, 0);
});

test("drainOutbox: eroare permanenta -> dead-letter + sters", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "discount", payload: {}, attempts: 0 };
  const { runtime, deleted } = makeRuntime([job]);
  const deadLetters: Array<{ job: OutboxJob; reason: string }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: true }),
    recordDeadLetter: async (j, reason) => { deadLetters.push({ job: j, reason }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 0);
  assert.equal(result.deadLettered, 1);
  assert.equal(result.retried, 0);
  assert.equal(result.queued, 0);
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, "permanent");
});

test("drainOutbox: esec tranzitoriu sub max -> reincercare cu backoff + release lease", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 1 };
  const { runtime, updated, deleted } = makeRuntime([job]);
  const now = new Date(10_000);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, now
  });
  assert.equal(result.retried, 1);
  assert.equal(result.queued, 1);
  assert.equal(deleted.length, 0);
  assert.equal(updated.length, 1);
  const update = updated[0].update as { $set: { attempts: number; availableAt: Date }; $unset: Record<string, string> };
  assert.equal(update.$set.attempts, 2);
  const delay = update.$set.availableAt.getTime() - 10_000;
  const base = 1000 * 2;
  assert.ok(delay >= base * 0.5 && delay <= base * 1.5, `backoff cu jitter in [${base * 0.5}, ${base * 1.5}], a fost ${delay}`);
  assert.ok("lockedUntil" in update.$unset && "lockedBy" in update.$unset, "lease eliberat la reincercare");
});

test("drainOutbox: un deliver care ARUNCA e tratat ca esec tranzitoriu si nu opreste restul drenarii", async () => {
  const jobs: OutboxJob[] = [
    { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" },
    { _id: "j2", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k2" }
  ];
  const { runtime, updated, deleted } = makeRuntime(jobs);
  let calls = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => {
      calls++;
      if (calls === 1) throw new Error("boom la livrare");
      return { ok: true };
    },
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(calls, 2, "ambele joburi au fost procesate (exceptia primului nu a oprit drenarea)");
  assert.equal(result.sent, 1, "al doilea job a fost livrat");
  assert.equal(result.retried, 1, "jobul care a aruncat e reprogramat (esec tranzitoriu)");
  assert.equal(result.deadLettered, 0);
  assert.equal(updated.length, 1, "jobul care a aruncat e re-pus in coada cu backoff");
  assert.deepEqual(deleted, [{ _id: "j2" }], "doar jobul livrat e sters");
});

test("drainOutbox: backoff-ul este plafonat (cap) chiar la attempts/backoff mari", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 3 };
  const { runtime, updated } = makeRuntime([job]);
  const now = new Date(0);
  await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 50, backoffMs: 1_000_000, limit: 50, now
  });
  const update = updated[0].update as { $set: { availableAt: Date } };
  const delay = update.$set.availableAt.getTime();
  const capMs = 30 * 60 * 1000;
  assert.ok(delay <= capMs * 1.5, `backoff plafonat la <= ${capMs * 1.5}ms (cu jitter), a fost ${delay}`);
});

test("drainOutbox: esec tranzitoriu la max attempts -> dead-letter + sters", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 4 };
  const { runtime, deleted, updated } = makeRuntime([job]);
  const deadLetters: Array<{ reason: string }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async (_j, reason) => { deadLetters.push({ reason }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.deadLettered, 1);
  assert.equal(result.queued, 0);
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(updated.length, 0);
  assert.equal(deadLetters[0].reason, "max-attempts");
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

test("drainOutbox: strict mode (deliver ok:false + recoveryFailed) -> numara recoveryFailures + reprogrameaza", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" };
  const { runtime, updated, deleted } = makeRuntime([job]);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false, recoveryFailed: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.recoveryFailures, 1, "esecul de verificare in strict mode e numarat chiar daca nu s-a trimis");
  assert.equal(result.retried, 1, "jobul e reprogramat cu backoff, nu trimis");
  assert.equal(result.sent, 0);
  assert.equal(deleted.length, 0, "jobul nu e sters in strict mode la esec de verificare");
  assert.equal(updated.length, 1, "lease eliberat + backoff aplicat");
});

test("drainOutbox: esecul de marcare in istoric incrementeaza markSentFailures dar jobul tot e livrat", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" };
  const pending = [job];
  const deleted: unknown[] = [];
  const model = {
    create: async (doc: Record<string, unknown>) => doc,
    findOneAndUpdate: async () => pending.shift() ?? null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async (filter: unknown) => { deleted.push(filter); return { deletedCount: 1 }; },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 0
  };
  const sentModel = {
    exists: async () => null,
    updateOne: async () => { throw new Error("mongo down la marcare"); }
  };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model as never,
    NotificationOutboxSentModel: sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const deadLetters: Array<{ reason: string; id: unknown }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (j, reason) => { deadLetters.push({ reason, id: (j as OutboxJob)._id }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1, "livrarea a reusit, jobul e considerat trimis");
  assert.equal(result.markSentFailures, 1, "esecul de marcare in istoricul de dedupe e numarat");
  assert.deepEqual(deleted, [{ _id: "j1" }], "jobul livrat e sters chiar daca marcarea a esuat (nu se re-livreaza -> fara duplicat)");
  assert.equal(deadLetters.length, 1, "esecul de marcare lasa un audit dead-letter, nu doar un counter tacut");
  assert.equal(deadLetters[0].reason, "delivered-marksent-failed", "motivul distinge cazul (mesaj livrat, marker de dedupe nepersistat)");
  assert.equal(deadLetters[0].id, "j1");
});

test("enqueueOutbox: eroarea de cheie duplicata (E11000) e ignorata (job pending identic exista deja)", async () => {
  let createCalls = 0;
  const model = {
    create: async () => { createCalls++; throw Object.assign(new Error("dup key"), { code: 11000 }); },
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 0 }),
    countDocuments: async () => 0
  };
  const sentModel = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model as never,
    NotificationOutboxSentModel: sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  await assert.doesNotReject(
    () => runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } }),
    "enqueue cu dedupeKey deja in coada nu trebuie sa arunce"
  );
  assert.equal(createCalls, 1, "s-a incercat o singura creare");
});

test("drainOutbox: sweep — joburi mai vechi decat maxAgeMs -> dead-letter (expired-near-ttl) + sters inainte de TTL", async () => {
  const stale = [
    { _id: "s1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) },
    { _id: "s2", guildId: "g2", channelId: "c2", kind: "discount", payload: {}, attempts: 2, createdAt: new Date(1000) }
  ] as unknown as OutboxJob[];
  const deleted: unknown[] = [];
  const findFilters: Array<{ createdAt?: { $lte?: unknown } }> = [];
  const model = {
    create: async (d: Record<string, unknown>) => d,
    findOneAndUpdate: async () => null,
    find: (filter: { createdAt?: { $lte?: unknown } }) => { findFilters.push(filter); return { sort: () => ({ limit: () => ({ lean: async () => stale }) }) }; },
    deleteOne: async (f: unknown) => { deleted.push(f); return { deletedCount: 1 }; },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 0
  };
  const sentModel = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model as never,
    NotificationOutboxSentModel: sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const deadLetters: Array<{ reason: string; id: unknown }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (j, reason) => { deadLetters.push({ reason, id: (j as OutboxJob)._id }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50, maxAgeMs: 6 * 24 * 3600_000, now: new Date(10 * 24 * 3600_000)
  });
  assert.equal(result.expired, 2, "ambele joburi vechi sunt mutate in dead-letter inainte sa le stearga TTL-ul Mongo");
  assert.equal(deadLetters.length, 2);
  assert.ok(deadLetters.every(d => d.reason === "expired-near-ttl"), "motivul de dead-letter este expired-near-ttl (audit, nu stergere tacuta)");
  assert.deepEqual(deleted, [{ _id: "s1" }, { _id: "s2" }], "joburile vechi sunt sterse dupa ce au fost dead-lettered");
  assert.ok(findFilters.some(f => f.createdAt && f.createdAt.$lte instanceof Date), "sweep-ul cauta joburi cu createdAt sub un cutoff");
});

test("drainOutbox: job revendicat mai vechi decat maxAgeMs e expirat INAINTE de deliver (nu se livreaza stale)", async () => {
  const oldJob = { _id: "old", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) } as unknown as OutboxJob;
  const pending = [oldJob];
  const deleted: unknown[] = [];
  let delivered = 0;
  const model = {
    create: async (d: Record<string, unknown>) => d,
    findOneAndUpdate: async () => pending.shift() ?? null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async (f: unknown) => { deleted.push(f); return { deletedCount: 1 }; },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 0
  };
  const sentModel = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model as never,
    NotificationOutboxSentModel: sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const deadLetters: Array<{ reason: string }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    recordDeadLetter: async (_j, reason) => { deadLetters.push({ reason }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50, maxAgeMs: 6 * 24 * 3600_000, now: new Date(10 * 24 * 3600_000)
  });
  assert.equal(delivered, 0, "jobul prea vechi NU e livrat (stale), expirarea se face inainte de deliver");
  assert.equal(result.expired, 1, "jobul vechi e numarat ca expirat");
  assert.equal(result.sent, 0);
  assert.deepEqual(deleted, [{ _id: "old" }]);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, "expired-near-ttl");
});

test("drainOutbox: fara maxAgeMs (sau 0) nu face sweep (expired=0)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime } = makeRuntime([job]);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.expired, 0, "fara maxAgeMs nu se face sweep de varsta");
});

test("enqueueOutbox: alte erori la create se propaga (nu sunt inghitite)", async () => {
  const model = {
    create: async () => { throw new Error("conexiune pierduta"); },
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 0 }),
    countDocuments: async () => 0
  };
  const sentModel = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model as never,
    NotificationOutboxSentModel: sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  await assert.rejects(
    () => runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } }),
    /conexiune pierduta/,
    "o eroare care nu e E11000 trebuie sa se propage"
  );
});
