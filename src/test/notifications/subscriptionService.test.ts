import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionService } from "../../features/notifications/subscriptionService.js";

type RecordedWrite = { filter: Record<string, unknown>; update: Record<string, unknown>; options?: Record<string, unknown> };

function makeHarness(input?: { finalizeMatchedCount?: number; rejectWrites?: boolean }) {
  const writes: RecordedWrite[] = [];
  const logs: Array<{ level: string; context: string; message: string }> = [];
  const service = createSubscriptionService({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        writes.push({ filter, update, options });
        if (input?.rejectWrites) throw new Error("mongo down");
        return { matchedCount: input?.finalizeMatchedCount ?? 1 };
      }
    },
    logger: (level, context, message) => { logs.push({ level, context, message }); },
    OP_UPDATE_OPTS: { writeConcern: { w: 1 } },
    makeActivationId: () => "act-1"
  });
  return { service, writes, logs };
}

function setOf(write: RecordedWrite): Record<string, unknown> {
  return write.update.$set as Record<string, unknown>;
}

test("startUpdates: activare + baseline + finalize cu gardul de activation-id, in aceasta ordine", async () => {
  const { service, writes } = makeHarness();
  const seedOrder: string[] = [];
  const outcome = await service.startUpdates("g1", "c1", async () => {
    seedOrder.push(`seed-dupa-${writes.length}-scrieri`);
  });
  assert.deepEqual(outcome, { status: "activated" });
  assert.deepEqual(seedOrder, ["seed-dupa-1-scrieri"], "baseline-ul ruleaza dupa scrierea de activare");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].filter, { _id: "g1" });
  assert.equal(setOf(writes[0]).subscribed, true);
  assert.equal(setOf(writes[0]).notificationChannelId, "c1");
  assert.equal(setOf(writes[0]).updatesActivationId, "act-1");
  assert.deepEqual(setOf(writes[0]).pendingUpdates, {});
  assert.equal(writes[0].options?.upsert, true);
  assert.equal(writes[1].filter.updatesActivationId, "act-1", "finalize-ul e conditionat de activation-id");
  assert.equal(writes[1].filter.subscribed, true);
  assert.equal(setOf(writes[1]).updatesInitializing, false);
  assert.ok(typeof setOf(writes[1]).seenHashVersionUpdates === "number");
});

test("startUpdates: finalize cu matchedCount 0 => superseded, fara rollback", async () => {
  const { service, writes, logs } = makeHarness({ finalizeMatchedCount: 0 });
  const outcome = await service.startUpdates("g1", "c1", async () => {});
  assert.deepEqual(outcome, { status: "superseded" });
  assert.equal(writes.length, 2, "doar activare + finalize, fara scriere de rollback");
  assert.equal(logs.length, 0);
});

test("startUpdates: baseline esuat => rollback conditionat de activation-id + WARN + invalidare", async () => {
  const { service, writes, logs } = makeHarness();
  const boom = new Error("baseline boom");
  const outcome = await service.startUpdates("g1", "c1", async () => { throw boom; });
  assert.deepEqual(outcome, { status: "baseline-failed", error: boom });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].filter, { _id: "g1", updatesActivationId: "act-1" });
  assert.equal(setOf(writes[1]).subscribed, false);
  assert.equal(setOf(writes[1]).notificationChannelId, null);
  const lastError = setOf(writes[1]).updatesLastError as { message: string; channelId: string };
  assert.equal(lastError.message, "baseline boom");
  assert.equal(lastError.channelId, "c1");
  assert.deepEqual(logs, [{ level: "WARN", context: "START_UPDATES", message: "Activat, dar baseline-ul initial a esuat" }]);
});

test("startDiscounts: foloseste campurile de reduceri si pendingDiscounts ca lista goala", async () => {
  const { service, writes } = makeHarness();
  const outcome = await service.startDiscounts("g2", "c2", async () => {});
  assert.deepEqual(outcome, { status: "activated" });
  assert.equal(setOf(writes[0]).discountsSubscribed, true);
  assert.equal(setOf(writes[0]).discountChannelId, "c2");
  assert.deepEqual(setOf(writes[0]).pendingDiscounts, []);
  assert.equal(writes[1].filter.discountsActivationId, "act-1");
  assert.ok(typeof setOf(writes[1]).seenHashVersionDiscounts === "number");
});

test("stopUpdates/stopDiscounts: o singura scriere care goleste pending si scoate activation-id", async () => {
  const { service, writes } = makeHarness();
  await service.stopUpdates("g1");
  await service.stopDiscounts("g1");
  assert.equal(writes.length, 2);
  assert.equal(setOf(writes[0]).subscribed, false);
  assert.deepEqual(setOf(writes[0]).pendingUpdates, {});
  assert.deepEqual(writes[0].update.$unset, { updatesActivationId: "" });
  assert.equal(setOf(writes[1]).discountsSubscribed, false);
  assert.deepEqual(setOf(writes[1]).pendingDiscounts, []);
  assert.deepEqual(writes[1].update.$unset, { discountsActivationId: "" });
});

test("startDlc/stopDlc: activare atomica cu activation-id + baseline + finalize (fara pending/seen-hash), $unset la stop (audit, #12)", async () => {
  const { service, writes } = makeHarness();
  const seedOrder: string[] = [];
  const outcome = await service.startDlc("g1", "c1", async () => { seedOrder.push(`seed-dupa-${writes.length}`); });
  assert.deepEqual(outcome, { status: "activated" });
  assert.deepEqual(seedOrder, ["seed-dupa-1"], "baseline-ul DLC ruleaza dupa scrierea de activare");
  assert.equal(writes.length, 2);
  assert.equal(setOf(writes[0]).dlcSubscribed, true);
  assert.equal(setOf(writes[0]).dlcChannelId, "c1");
  assert.equal(setOf(writes[0]).dlcInitializing, true);
  assert.equal(setOf(writes[0]).dlcActivationId, "act-1");
  assert.equal(writes[0].options?.upsert, true);
  assert.equal("pendingDlc" in setOf(writes[0]), false, "DLC nu are camp de pending");
  assert.equal(writes[1].filter.dlcActivationId, "act-1", "finalize conditionat de activation-id");
  assert.equal(setOf(writes[1]).dlcInitializing, false);
  assert.equal("seenHashVersionDlc" in setOf(writes[1]), false, "DLC nu are seen-hash-version");

  await service.stopDlc("g1");
  assert.equal(setOf(writes[2]).dlcSubscribed, false);
  assert.equal(setOf(writes[2]).dlcChannelId, null);
  assert.deepEqual(writes[2].update.$unset, { dlcActivationId: "" });
});

test("startDlc: baseline esuat => rollback conditionat de activation-id + dlcLastError + WARN (audit, #12)", async () => {
  const { service, writes, logs } = makeHarness();
  const boom = new Error("dlc baseline boom");
  const outcome = await service.startDlc("g1", "c1", async () => { throw boom; });
  assert.deepEqual(outcome, { status: "baseline-failed", error: boom });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].filter, { _id: "g1", dlcActivationId: "act-1" });
  assert.equal(setOf(writes[1]).dlcSubscribed, false);
  assert.equal(setOf(writes[1]).dlcChannelId, null);
  const lastError = setOf(writes[1]).dlcLastError as { message: string; channelId: string };
  assert.equal(lastError.message, "dlc baseline boom");
  assert.equal(lastError.channelId, "c1");
  assert.deepEqual(logs, [{ level: "WARN", context: "START_DLC", message: "Activat, dar baseline-ul DLC a esuat" }]);
});

test("addPlayerCountGame/setPlayerCountGames: $addToSet la pornire; lista goala opreste modulul si goleste canalul (runda 10)", async () => {
  const { service, writes } = makeHarness();
  await service.addPlayerCountGame("g1", "c1", "cs2");
  assert.deepEqual(writes[0].update.$addToSet, { playerCountGames: "cs2" });
  assert.equal(setOf(writes[0]).playerCountSubscribed, true);
  await service.setPlayerCountGames("g1", ["dota"], "c1");
  assert.deepEqual(setOf(writes[1]), { playerCountGames: ["dota"], playerCountSubscribed: true, playerCountChannelId: "c1" });
  await service.setPlayerCountGames("g1", [], "c1");
  assert.deepEqual(setOf(writes[2]), { playerCountGames: [], playerCountSubscribed: false, playerCountChannelId: null }, "lista goala dezaboneaza si goleste canalul");
});

test("rollbackActivation: esecul scrierii de rollback nu arunca, dar tot logheaza si invalideaza", async () => {
  const { service, logs } = makeHarness({ rejectWrites: true });
  await service.rollbackActivation("discounts", "g3", "c3", "act-x", new Error("seed a picat"));
  assert.deepEqual(logs, [{ level: "WARN", context: "START_DISCOUNTS", message: "Activat, dar baseline-ul de reduceri a esuat" }]);
});
