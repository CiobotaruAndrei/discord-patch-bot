import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult, applyDedupeMarker, isDeliverableOutboxPayload, messageHasDedupeMarker, outboxDedupeMarker } from "../features/notifications/notificationOutbox.js";
import { makeFakeModel, makeMetricsModel, makeRuntime, makeSweepRuntime, type OutboxModelMock, type OutboxSentModelMock } from "./outboxTestKit.js";

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
