import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRepository } from "../../features/notifications/outboxRepository.js";
import { makeFakeModel } from "../outboxTestKit.js";
import type { OutboxJob } from "../../features/notifications/outboxTypes.js";

function makeRepo(jobs: OutboxJob[]) {
  const fake = makeFakeModel(jobs);
  const repository = createOutboxRepository({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn()
  });
  return { repository, fake };
}

test("claimNextJob seteaza status leased + statusChangedAt in acelasi update atomic cu lease-ul", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { repository, fake } = makeRepo([job]);
  const now = new Date("2026-07-13T10:00:00Z");
  await repository.claimNextJob(now, 60_000, "w1");
  const claim = fake.claims[0].update as { $set: { status: string; statusChangedAt: Date; lockedUntil: Date } };
  assert.equal(claim.$set.status, "leased");
  assert.equal(claim.$set.statusChangedAt.getTime(), now.getTime());
  assert.equal(claim.$set.lockedUntil.getTime(), now.getTime() + 60_000);
});

test("claimNextJob exclude statusurile terminale dar accepta docuri legacy fara status", async () => {
  const { repository, fake } = makeRepo([]);
  await repository.claimNextJob(new Date(), 1000, "w1");
  const filter = fake.claims[0].filter as { $and: Array<{ $or: Array<Record<string, unknown>> }> };
  const statusClause = filter.$and[0].$or;
  assert.deepEqual(statusClause[0], { status: { $in: ["queued", "leased"] } }, "doar joburile active sunt revendicabile");
  assert.deepEqual(statusClause[1], { status: { $exists: false } }, "docurile de dinainte de migrarea m13 raman revendicabile");
});

test("finalizeJob scrie statusul terminal + statusChangedAt si elibereaza lease-ul intr-un singur update (finalizare atomica single-doc)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { repository, fake } = makeRepo([job]);
  const now = new Date("2026-07-13T11:00:00Z");
  await repository.finalizeJob("j1", "delivered", now);
  assert.equal(fake.updated.length, 1, "finalizarea e UN singur updateOne (atomic pe document)");
  const update = fake.updated[0].update as { $set: { status: string; statusChangedAt: Date }; $unset: Record<string, string> };
  assert.equal(update.$set.status, "delivered");
  assert.equal(update.$set.statusChangedAt.getTime(), now.getTime());
  assert.deepEqual(Object.keys(update.$unset).sort(), ["lockedBy", "lockedUntil"], "lease-ul e eliberat in acelasi update");
});

test("scheduleRetry readuce jobul in queued (tranzitie explicita, nu doar unset de lock)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { repository, fake } = makeRepo([job]);
  await repository.scheduleRetry("j1", 2, new Date());
  const update = fake.updated[0].update as { $set: { status: string; attempts: number } };
  assert.equal(update.$set.status, "queued");
  assert.equal(update.$set.attempts, 2);
});
