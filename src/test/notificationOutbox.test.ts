import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult, applyDedupeMarker, isDeliverableOutboxPayload, messageHasDedupeMarker, outboxDedupeMarker } from "../features/notifications/notificationOutbox";
type OutboxRuntimeDeps = Parameters<typeof createOutboxRuntime>[0];
type OutboxModelMock = OutboxRuntimeDeps["NotificationOutboxModel"];
type OutboxSentModelMock = OutboxRuntimeDeps["NotificationOutboxSentModel"];

function makeFakeModel(jobs: OutboxJob[], initialSent: string[] = [], enforceUniqueDedupe = false) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const updated: Array<{ filter: unknown; update: unknown }> = [];
  const claims: Array<{ filter: unknown; update: unknown }> = [];
  const sentKeys = new Set<string>(initialSent);
  const pending = [...jobs];
  const model: OutboxModelMock = {
    create: async (doc: Record<string, unknown>) => {
      if (enforceUniqueDedupe && doc.dedupeKey && created.some(existing => existing.dedupeKey === doc.dedupeKey)) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      }
      created.push(doc);
      return doc;
    },
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
  const sentModel: OutboxSentModelMock = {
    exists: async (filter: { dedupeKey: string }) => (sentKeys.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sentKeys.add(filter.dedupeKey); return { upsertedCount: 1 }; }
  };
  return { model, sentModel, created, deleted, updated, claims, sentKeys };
}

function makeRuntime(jobs: OutboxJob[], initialSent: string[] = [], enforceUniqueDedupe = false) {
  const fake = makeFakeModel(jobs, initialSent, enforceUniqueDedupe);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
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

test("enqueueOutbox: indexul unique pe dedupeKey previne duplicatul in-flight la re-enqueue (replay idempotent, R #5)", async () => {
  const { runtime, created } = makeRuntime([], [], true);
  const job = { guildId: "g1", channelId: "c1", kind: "update" as const, payload: { x: 1 } };
  await runtime.enqueueOutbox(job);
  await runtime.enqueueOutbox(job);
  assert.equal(created.length, 1, "al doilea enqueue cu acelasi continut, cat primul e inca in coada (nelivrat), e respins de indexul unique (11000) -> niciun duplicat, replay-ul e idempotent");
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

test("drainOutbox: lease-ul foloseste now-ul injectat (lockedUntil = now + leaseMs)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, claims } = makeRuntime([job]);
  const now = new Date("2026-01-01T00:00:00.000Z");
  await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, now, leaseMs: 90_000
  });
  const claimUpdate = claims[0].update as { $set: { lockedUntil: Date } };
  assert.equal(claimUpdate.$set.lockedUntil.getTime(), now.getTime() + 90_000,
    "lockedUntil deriva din now-ul injectat, nu din Date.now()");
});

test("drainOutbox: un job al carui guild s-a dezabonat intre enqueue si drain e scos din coada FARA livrare (R12 #1)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, deleted } = makeRuntime([job]);
  let delivered = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    isStillSubscribed: async () => false,
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(delivered, 0, "jobul NU este livrat dupa dezabonare");
  assert.equal(result.sent, 0, "nu se numara ca trimis");
  assert.equal(result.deadLettered, 0, "dezabonarea nu e un esec -> fara dead-letter");
  assert.equal(result.droppedUnsubscribed, 1, "jobul e numarat ca scos pentru dezabonare");
  assert.equal(deleted.length, 1, "jobul e sters din coada (dequeue)");
});

test("drainOutbox: un job al carui guild e inca abonat se livreaza normal (isStillSubscribed=true)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime } = makeRuntime([job]);
  let delivered = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    isStillSubscribed: async () => true,
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(delivered, 1, "guild inca abonat -> livrare normala");
  assert.equal(result.sent, 1);
  assert.equal(result.droppedUnsubscribed, 0);
});

test("drainOutbox: eroarea de verificare a abonarii amana jobul fara livrare fail-open", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, updated, deleted } = makeRuntime([job]);
  let delivered = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    isStillSubscribed: async () => { throw new Error("mongo down"); },
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(delivered, 0, "nu livreaza cand nu poate confirma abonarea");
  assert.equal(result.sent, 0);
  assert.equal(result.retried, 1);
  assert.equal(result.droppedUnsubscribed, 0);
  assert.equal(deleted.length, 0, "jobul ramane in coada pentru retry");
  const retryUpdate = updated[0].update as { $set: { attempts: number; availableAt: Date }; $unset: { lockedUntil: string; lockedBy: string } };
  assert.equal(retryUpdate.$set.attempts, 1);
  assert.ok(retryUpdate.$set.availableAt instanceof Date);
  assert.equal(retryUpdate.$unset.lockedUntil, "");
  assert.equal(retryUpdate.$unset.lockedBy, "");
});

test("drainOutbox: o stergere esuata nu opreste drain-ul si se numara in deleteFailures", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "dk1" };
  const fake = makeFakeModel([job]);
  const failingModel: OutboxModelMock = { ...fake.model, deleteOne: async () => { throw new Error("mongo down"); } };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: failingModel,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1, "jobul livrat e numarat ca trimis chiar daca stergerea pica");
  assert.equal(result.deleteFailures, 1, "stergerea esuata e contorizata separat, fara sa abandoneze ciclul");
});

test("drainOutbox: sweep-ul TTL care nu poate sterge job-ul numara deleteFailures (nu il pierde silentios)", async () => {
  const staleJob: OutboxJob = { _id: "old1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) };
  const fake = makeFakeModel([staleJob]);
  const sweepFailingModel: OutboxModelMock = {
    ...fake.model,
    findOneAndUpdate: async () => null,
    deleteOne: async () => { throw new Error("mongo down la sweep"); }
  };
  const deadLetters: string[] = [];
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: sweepFailingModel,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (_job, reason) => { deadLetters.push(reason); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 1000
  });
  assert.equal(result.deleteFailures, 1, "stergerea esuata din sweep-ul TTL e contorizata in deleteFailures");
  assert.equal(result.expired, 0, "fara o stergere reusita jobul nu e numarat ca expirat");
  assert.equal(deadLetters.length, 1, "audit-ul dead-letter e scris INAINTE de delete, deci o stergere esuata nu pierde audit-ul/replay payload-ul (review manual #3)");
  assert.equal(deadLetters[0], "expired-near-ttl", "motivul de audit e expired-near-ttl");
});

test("drainOutbox: sweep-ul TTL scrie audit dead-letter inainte de a sterge jobul vechi (happy path)", async () => {
  const staleJob: OutboxJob = { _id: "old2", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) };
  const fake = makeFakeModel([staleJob]);
  const sweepModel: OutboxModelMock = { ...fake.model, findOneAndUpdate: async () => null };
  const deadLetters: string[] = [];
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: sweepModel,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (_job, reason) => { deadLetters.push(reason); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 1000
  });
  assert.equal(result.expired, 1, "jobul vechi e numarat ca expirat dupa stergere");
  assert.equal(deadLetters.length, 1, "exact un audit dead-letter scris");
});

test("drainOutbox: sweep-ul TTL NU sterge jobul daca auditul dead-letter esueaza (nu pierde payload-ul de replay, review R5 #2)", async () => {
  const staleJob: OutboxJob = { _id: "old3", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) };
  const fake = makeFakeModel([staleJob]);
  const sweepModel: OutboxModelMock = { ...fake.model, findOneAndUpdate: async () => null };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: sweepModel,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => { throw new Error("colectia dead-letter cazuta"); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 1000
  });
  assert.equal(fake.deleted.length, 0, "auditul esuat -> NU se incearca stergerea (jobul ramane in coada)");
  assert.equal(result.deadLetterFailures, 1, "esecul auditului dead-letter e contorizat");
  assert.equal(result.expired, 0, "jobul nu e numarat ca expirat fiindca nu a fost sters");
  assert.equal(result.deleteFailures, 0, "nicio stergere incercata -> zero deleteFailures");
});

test("drainOutbox: expirarea in bucla principala NU sterge jobul daca auditul dead-letter esueaza (review R5 #2)", async () => {
  const staleJob: OutboxJob = { _id: "old4", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) };
  const fake = makeFakeModel([staleJob]);
  let claimed = false;
  const loopModel: OutboxModelMock = {
    ...fake.model,
    findOneAndUpdate: async () => { if (claimed) return null; claimed = true; return staleJob; },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] as OutboxJob[] }) }) })
  };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: loopModel,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => { throw new Error("dead-letter cazut"); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 1000
  });
  assert.equal(fake.deleted.length, 0, "expirare in bucla cu audit esuat -> jobul NU e sters");
  assert.equal(result.deadLetterFailures, 1, "esecul auditului dead-letter e contorizat si in bucla principala");
  assert.equal(result.expired, 0, "fara stergere, jobul nu e numarat ca expirat");
});

test("drainOutbox: livrare permanent-esuata NU sterge jobul daca auditul dead-letter esueaza (review R6 #1)", async () => {
  const job: OutboxJob = { _id: "perm1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const fake = makeFakeModel([job]);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: true }),
    recordDeadLetter: async () => { throw new Error("colectia dead-letter cazuta"); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 0
  });
  assert.equal(fake.deleted.length, 0, "audit esuat -> jobul terminal NU e sters (payload de replay pastrat)");
  assert.equal(result.deadLetterFailures, 1, "esecul auditului dead-letter e contorizat si pe calea permanent/max-attempts");
  assert.equal(result.deadLettered, 0, "jobul nu e numarat ca dead-lettered fiindca nu a fost finalizat/sters");
});

test("drainOutbox: livrare permanent-esuata cu audit reusit sterge jobul si il numara dead-lettered (happy path)", async () => {
  const job: OutboxJob = { _id: "perm2", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const fake = makeFakeModel([job]);
  const deadLetters: string[] = [];
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: true }),
    recordDeadLetter: async (_job, reason) => { deadLetters.push(reason); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 0
  });
  assert.equal(result.deadLettered, 1, "audit reusit -> jobul terminal e finalizat in dead-letter");
  assert.equal(fake.deleted.length, 1, "jobul e sters dupa auditul reusit");
  assert.equal(result.deadLetterFailures, 0, "fara esec de audit");
  assert.deepEqual(deadLetters, ["permanent"]);
});

test("drainOutbox: livrare la max-attempts NU sterge jobul daca auditul dead-letter esueaza (review R7 #3)", async () => {
  const job: OutboxJob = { _id: "maxa1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 4 };
  const fake = makeFakeModel([job]);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async () => { throw new Error("colectia dead-letter cazuta"); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 0
  });
  assert.equal(fake.deleted.length, 0, "esec tranzitoriu la attempts>=maxAttempts cu audit esuat -> jobul NU e sters");
  assert.equal(result.deadLetterFailures, 1, "esecul auditului dead-letter e contorizat si pe calea max-attempts");
  assert.equal(result.deadLettered, 0, "jobul nu e numarat ca dead-lettered fiindca nu a fost finalizat/sters");
});

test("drainOutbox: livrare la max-attempts cu audit reusit sterge jobul cu motivul max-attempts (happy path)", async () => {
  const job: OutboxJob = { _id: "maxa2", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 4 };
  const fake = makeFakeModel([job]);
  const deadLetters: string[] = [];
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async (_job, reason) => { deadLetters.push(reason); },
    maxAttempts: 5, backoffMs: 1000, limit: 5, maxAgeMs: 0
  });
  assert.equal(result.deadLettered, 1, "attempts>=maxAttempts cu audit reusit -> dead-letter finalizat");
  assert.equal(fake.deleted.length, 1, "jobul e sters dupa auditul reusit");
  assert.deepEqual(deadLetters, ["max-attempts"], "motivul de audit e max-attempts, nu permanent");
});

test("drainOutbox: markSent esuat + audit dead-letter esuat -> esecul auditului nu mai e silentios, dar jobul deja livrat e sters (review R8 #1)", async () => {
  const job: OutboxJob = { _id: "ms1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "dk-ms1" };
  const fake = makeFakeModel([job]);
  const failingSent: OutboxSentModelMock = {
    ...fake.sentModel,
    updateOne: async () => { throw new Error("mongo down la markSent"); }
  };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: failingSent,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => { throw new Error("colectia dead-letter cazuta"); },
    maxAttempts: 5, backoffMs: 1000, limit: 5
  });
  assert.equal(result.markSentFailures, 1, "markSent esuat e contorizat");
  assert.equal(result.deadLetterFailures, 1, "esecul auditului dead-letter NU mai e silentios pe calea delivered-marksent-failed");
  assert.equal(result.sent, 1, "mesajul a fost livrat");
  assert.equal(fake.deleted.length, 1, "jobul deja livrat e sters chiar daca auditul esueaza, ca sa nu se duplice mesajul");
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

test("drainOutbox: esecul de marcare in istoric opreste drain-ul curent dupa jobul livrat", async () => {
  const jobs: OutboxJob[] = [
    { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" },
    { _id: "j2", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k2" }
  ];
  const pending = [...jobs];
  const deleted: unknown[] = [];
  const model: OutboxModelMock = {
    create: async (doc: Record<string, unknown>) => doc,
    findOneAndUpdate: async () => pending.shift() ?? null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async (filter: unknown) => { deleted.push(filter); return { deletedCount: 1 }; },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 0
  };
  const sentModel: OutboxSentModelMock = {
    exists: async () => null,
    updateOne: async () => { throw new Error("mongo down la marcare"); }
  };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const deadLetters: Array<{ reason: string; job: OutboxJob }> = [];
  let deliveries = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { deliveries++; return { ok: true }; },
    recordDeadLetter: async (j, reason) => { deadLetters.push({ reason, job: j }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1, "livrarea a reusit, jobul e considerat trimis");
  assert.equal(result.total, 1, "drain-ul curent se opreste dupa esecul de markSent, fara sa revendice alte joburi");
  assert.equal(deliveries, 1, "nu continua livrarea altor joburi cat timp istoricul de dedupe e degradat");
  assert.equal(result.markSentFailures, 1, "esecul de marcare in istoricul de dedupe e numarat");
  assert.deepEqual(deleted, [{ _id: "j1" }], "jobul livrat e sters chiar daca marcarea a esuat (nu se re-livreaza -> fara duplicat)");
  assert.equal(deadLetters.length, 1, "esecul de marcare lasa un audit dead-letter, nu doar un counter tacut");
  assert.equal(deadLetters[0].reason, "delivered-marksent-failed", "motivul distinge cazul (mesaj livrat, marker de dedupe nepersistat)");
  assert.equal(deadLetters[0].job._id, "j1");
  assert.equal(deadLetters[0].job.channelId, "c1", "jobul dus la dead-letter poarta channelId -> audit recuperabil");
  assert.equal(deadLetters[0].job.dedupeKey, "k1", "jobul dus la dead-letter poarta dedupeKey -> reconciliere posibila");
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

test("drainOutbox: sweep — joburi mai vechi decat maxAgeMs -> dead-letter (expired-near-ttl) + sters inainte de TTL", async () => {
  const stale: OutboxJob[] = [
    { _id: "s1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) },
    { _id: "s2", guildId: "g2", channelId: "c2", kind: "discount", payload: {}, attempts: 2, createdAt: new Date(1000) }
  ];
  const deleted: unknown[] = [];
  const findFilters: Array<{ createdAt?: { $lte?: unknown } }> = [];
  const model: OutboxModelMock = {
    create: async (d: Record<string, unknown>) => d,
    findOneAndUpdate: async () => null,
    find: (filter: { createdAt?: { $lte?: unknown } }) => { findFilters.push(filter); return { sort: () => ({ limit: () => ({ lean: async () => stale }) }) }; },
    deleteOne: async (f: unknown) => { deleted.push(f); return { deletedCount: 1 }; },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 0
  };
  const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
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
  assert.deepEqual(deleted.map(d => (d as { _id: string })._id), ["s1", "s2"], "joburile vechi sunt sterse dupa ce au fost dead-lettered");
  assert.ok(deleted.every(d => Array.isArray((d as { $or?: unknown[] }).$or)), "stergerea include garda de lease (nu sterge un job revendicat intre timp)");
  assert.ok(findFilters.some(f => f.createdAt && f.createdAt.$lte instanceof Date), "sweep-ul cauta joburi cu createdAt sub un cutoff");
  assert.ok(findFilters.some(f => Array.isArray((f as { $or?: unknown[] }).$or)), "sweep-ul exclude joburile cu lease activ");
});

test("drainOutbox: job revendicat mai vechi decat maxAgeMs e expirat INAINTE de deliver (nu se livreaza stale)", async () => {
  const oldJob: OutboxJob = { _id: "old", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(0) };
  const pending = [oldJob];
  const deleted: unknown[] = [];
  let delivered = 0;
  const model: OutboxModelMock = {
    create: async (d: Record<string, unknown>) => d,
    findOneAndUpdate: async () => pending.shift() ?? null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async (f: unknown) => { deleted.push(f); return { deletedCount: 1 }; },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 0
  };
  const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
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

function leaseFreeMatches(filter: { $or?: Array<{ lockedUntil: unknown }> }, job: { lockedUntil?: Date | null }): boolean {
  if (!filter || !Array.isArray(filter.$or)) return true;
  return filter.$or.some(clause => {
    if (clause.lockedUntil === null) return job.lockedUntil == null;
    const lte = (clause.lockedUntil as { $lte?: Date } | undefined)?.$lte;
    return lte ? Boolean(job.lockedUntil && job.lockedUntil <= lte) : false;
  });
}

function makeSweepRuntime(job: OutboxJob & { lockedUntil?: Date | null }) {
  const deleted: unknown[] = [];
  const deadLettered: unknown[] = [];
  const model: OutboxModelMock = {
    create: async (doc: Record<string, unknown>) => doc,
    findOneAndUpdate: async () => null,
    find: (filter: { $or?: Array<{ lockedUntil: unknown }> }) => ({
      sort: () => ({ limit: () => ({ lean: async () => (leaseFreeMatches(filter, job) ? [job] : []) }) })
    }),
    deleteOne: async (filter: { _id: string; $or?: Array<{ lockedUntil: unknown }> }) => {
      const ok = filter._id === job._id && leaseFreeMatches(filter, job);
      if (ok) deleted.push(filter);
      return { deletedCount: ok ? 1 : 0 };
    },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 1
  };
  const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  return { runtime, deleted, deadLettered };
}

test("drainOutbox sweep: NU sterge/dead-letter un job vechi inca LEASED (lockedUntil in viitor)", async () => {
  const job = { _id: "j1", guildId: "g", channelId: "c", kind: "update" as const, payload: {}, attempts: 0, createdAt: new Date(0), lockedUntil: new Date(Date.now() + 60_000) };
  const { runtime, deleted, deadLettered } = makeSweepRuntime(job);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (j) => { deadLettered.push(j); },
    maxAttempts: 5, backoffMs: 1000, limit: 10, maxAgeMs: 1
  });
  assert.equal(deadLettered.length, 0, "jobul leased nu trebuie dead-letter-uit");
  assert.equal(deleted.length, 0, "jobul leased nu trebuie sters");
  assert.equal(result.deadLettered, 0);
});

test("drainOutbox sweep: sterge + dead-letter un job vechi FARA lease activ", async () => {
  const job = { _id: "j2", guildId: "g", channelId: "c", kind: "update" as const, payload: {}, attempts: 0, createdAt: new Date(0), lockedUntil: null };
  const { runtime, deleted, deadLettered } = makeSweepRuntime(job);
  await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (j) => { deadLettered.push(j); },
    maxAttempts: 5, backoffMs: 1000, limit: 10, maxAgeMs: 1
  });
  assert.equal(deadLettered.length, 1, "jobul vechi nelease-uit e dead-letter-uit");
  assert.equal(deleted.length, 1, "si sters");
});

function makeMetricsModel(jobs: OutboxJob[]): OutboxModelMock {
  return {
    create: async (doc: Record<string, unknown>) => doc,
    findOneAndUpdate: async () => null,
    find: (filter: { availableAt?: { $lte?: Date } }) => {
      const lte = filter?.availableAt?.$lte;
      const due = lte
        ? jobs.filter(j => j.availableAt && new Date(j.availableAt).getTime() <= lte.getTime())
        : jobs.slice();
      const sorted = due.slice().sort((a, b) => new Date(a.availableAt as Date).getTime() - new Date(b.availableAt as Date).getTime());
      return { sort: () => ({ limit: () => ({ lean: async () => sorted.slice(0, 1) }) }) };
    },
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 0 }),
    countDocuments: async (filter?: { availableAt?: { $gt?: Date } }) => {
      const gt = filter?.availableAt?.$gt;
      if (gt) return jobs.filter(j => j.availableAt && new Date(j.availableAt).getTime() > gt.getTime()).length;
      return jobs.length;
    }
  } as OutboxModelMock;
}

test("drainOutbox metrics: oldestJobAgeMs numara doar joburile DUE (availableAt<=now), iar cele programate in viitor merg in futureScheduledCount (R12 #2)", async () => {
  const now = new Date("2026-06-25T12:00:00.000Z");
  const jobs: OutboxJob[] = [
    { _id: "due", guildId: "g", channelId: "c", kind: "update", payload: {}, attempts: 0, createdAt: new Date(now.getTime() - 100_000), availableAt: new Date(now.getTime() - 50_000) },
    { _id: "fut1", guildId: "g", channelId: "c", kind: "update", payload: {}, attempts: 0, createdAt: new Date(now.getTime() - 200_000), availableAt: new Date(now.getTime() + 600_000) },
    { _id: "fut2", guildId: "g", channelId: "c", kind: "update", payload: {}, attempts: 0, createdAt: new Date(now.getTime() - 30_000), availableAt: new Date(now.getTime() + 1_200_000) }
  ];
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: makeMetricsModel(jobs),
    NotificationOutboxSentModel: makeFakeModel([]).sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, now, maxAgeMs: 0
  });
  assert.equal(result.oldestJobAgeMs, 50_000, "vechimea se masoara de cand jobul DUE a devenit eligibil (now - availableAt = 50s), nu de la createdAt; joburile viitoare sunt excluse");
  assert.equal(result.futureScheduledCount, 2, "cele doua joburi cu availableAt>now sunt raportate separat, ca sa nu para coada veche/blocata");
});

test("drainOutbox metrics: oldestJobAgeMs se calculeaza din availableAt, nu createdAt - un retry creat demult dar abia devenit due NU pare batran (R13 #2)", async () => {
  const now = new Date("2026-06-25T12:00:00.000Z");
  const jobs: OutboxJob[] = [
    { _id: "old-created-recent-due", guildId: "g", channelId: "c", kind: "update", payload: {}, attempts: 3, createdAt: new Date(now.getTime() - 500_000), availableAt: new Date(now.getTime() - 10_000) },
    { _id: "new-created-long-due", guildId: "g", channelId: "c", kind: "update", payload: {}, attempts: 0, createdAt: new Date(now.getTime() - 20_000), availableAt: new Date(now.getTime() - 300_000) }
  ];
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: makeMetricsModel(jobs),
    NotificationOutboxSentModel: makeFakeModel([]).sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, now, maxAgeMs: 0
  });
  assert.equal(result.oldestJobAgeMs, 300_000, "cel mai vechi DUE e cel cu availableAt minim (due de 300s); jobul de retry creat acum 500s dar due abia de 10s NU domina metrica");
});

test("drainOutbox: o scriere de history esuata NU blocheaza livrarea, dar e contorizata in historyWriteFailures (R15 #4)", async () => {
  const job: OutboxJob = { _id: "h1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k-h1", history: [{ kind: "update", title: "Patch", itemId: "i1" }] };
  const { runtime, deleted } = makeRuntime([job]);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    recordSentHistory: async () => { throw new Error("history mongo indisponibil"); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1, "livrarea reuseste chiar daca scrierea /history a esuat (nu blocheaza trimiterea)");
  assert.equal(result.historyWriteFailures, 1, "esecul de scriere /history e contorizat (vizibilitate prin bot_history_write_failures + admin alert)");
  assert.equal(deleted.length, 1, "jobul livrat e sters normal");
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

test("drain: payload nelivrabil e mutat in dead-letter cu motivul invalid-payload, fara sa apeleze deliver, iar drenarea continua (R[Arh] #5)", async () => {
  const invalidJob: OutboxJob = { _id: "j-invalid", guildId: "g1", channelId: "c1", kind: "update", payload: "payload-corupt", attempts: 0 };
  const validJob: OutboxJob = { _id: "j-valid", guildId: "g1", channelId: "c1", kind: "discount", payload: { embeds: [{ title: "ok" }] }, attempts: 0 };
  const { runtime, deleted } = makeRuntime([invalidJob, validJob]);
  const deliveredIds: unknown[] = [];
  const deadLetters: Array<{ id: unknown; reason: string }> = [];

  const result = await runtime.drainOutbox({
    deliver: async job => { deliveredIds.push(job._id); return { ok: true }; },
    recordDeadLetter: async (job, reason) => { deadLetters.push({ id: job._id, reason }); },
    maxAttempts: 5,
    backoffMs: 1000,
    limit: 10
  });

  assert.deepEqual(deadLetters, [{ id: "j-invalid", reason: "invalid-payload" }], "payload-ul gol e terminal (permanent), nu reincercat");
  assert.deepEqual(deliveredIds, ["j-valid"], "deliver nu e apelat pentru payload nelivrabil, dar drenarea continua cu urmatorul job");
  assert.equal(result.deadLettered, 1);
  assert.equal(result.sent, 1);
  assert.ok(deleted.some(filter => (filter as { _id?: unknown })._id === "j-invalid"), "jobul invalid e sters dupa auditul dead-letter");
});

test("drain: verificarea abonarii ruleaza INAINTEA validarii de payload (un job dezabonat cu payload corupt e doar drop, nu dead-letter)", async () => {
  const job: OutboxJob = { _id: "j-unsub", guildId: "g1", channelId: "c1", kind: "youtube", payload: "payload-corupt", attempts: 0 };
  const { runtime } = makeRuntime([job]);
  const deadLetters: string[] = [];

  const result = await runtime.drainOutbox({
    deliver: async () => ({ ok: true }),
    isStillSubscribed: async () => false,
    recordDeadLetter: async (_job, reason) => { deadLetters.push(reason); },
    maxAttempts: 5,
    backoffMs: 1000,
    limit: 10
  });

  assert.deepEqual(deadLetters, [], "jobul dezabonat nu ajunge la validarea de payload");
  assert.equal(result.droppedUnsubscribed, 1);
  assert.equal(result.deadLettered, 0);
});
