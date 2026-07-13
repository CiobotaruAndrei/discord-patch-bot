import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult, applyDedupeMarker, isDeliverableOutboxPayload, messageHasDedupeMarker, outboxDedupeMarker } from "../features/notifications/notificationOutbox.js";
import { makeFakeModel, makeRuntime, makeSweepRuntime, type OutboxModelMock, type OutboxSentModelMock } from "./outboxTestKit.js";

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
