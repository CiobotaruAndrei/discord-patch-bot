import test from "node:test";
import assert from "node:assert/strict";

import { buildDealsHashIndex, planDiscountFailure, planPendingDiscounts } from "../../features/notifications/discountNotificationPlanner.js";
import type { PendingDiscount } from "../../features/notifications/notificationTypes.js";
import type { DealInfo, ValidatedDealInfo } from "../../sources/sourceTypes.js";
import { makeDealInfo } from "../typedTestBuilders.js";

const NOW = new Date("2026-07-05T10:00:00.000Z");

function deal(title: string): DealInfo {
  return makeDealInfo({ title });
}

function pendingItem(hash: string, snapshot: DealInfo | null, attempts = 0): PendingDiscount {
  return { hash, snapshot, lastSeenAt: new Date("2026-07-01T00:00:00.000Z"), attempts } as PendingDiscount;
}

const acceptAll = (deal: DealInfo | ValidatedDealInfo) => Boolean(deal);
const validateAll = (snapshot: unknown): snapshot is ValidatedDealInfo => Boolean(snapshot);

test("buildDealsHashIndex: deduplica pe hash si pastreaza ordinea primei aparitii", () => {
  const first = deal("A");
  const duplicate = deal("A-dup");
  const second = deal("B");
  const index = buildDealsHashIndex([first, duplicate, second], d => (d.title === "B" ? "h2" : "h1"));
  assert.deepEqual(index.orderedHashes, ["h1", "h2"]);
  assert.equal(index.dealsByHash.get("h1"), first, "prima aparitie castiga la hash duplicat");
  assert.equal(index.dealsByHash.get("h2"), second);
});

test("planPendingDiscounts: pending vechi — seen si max-attempts se arunca, fresh se reimprospateaza, gratia incrementeaza attempts", () => {
  const freshDeal = deal("fresh");
  const pending = planPendingDiscounts({
    oldPending: [
      pendingItem("seen", deal("seen"), 0),
      pendingItem("exhausted", deal("exhausted"), 3),
      pendingItem("fresh", deal("stale-snapshot"), 1),
      pendingItem("graced", deal("graced"), 0),
      pendingItem("out-of-grace", deal("old"), 2)
    ],
    orderedHashes: ["fresh"],
    dealsByHash: new Map([["fresh", freshDeal]]),
    seenSet: new Set(["seen"]),
    now: NOW,
    maxAttempts: 3,
    graceCycles: 2,
    limit: 10,
    passesFilters: acceptAll,
    validateSnapshot: validateAll
  });
  assert.deepEqual(pending.map(item => item.hash), ["fresh", "graced"]);
  assert.equal(pending[0].snapshot, freshDeal, "snapshotul e reimprospatat din feed");
  assert.equal(pending[0].lastSeenAt, NOW);
  assert.equal(pending[0].attempts, 1, "attempts se pastreaza la reimprospatare");
  assert.equal(pending[1].attempts, 1, "gratia incrementeaza attempts pentru itemul absent din feed");
});

test("planPendingDiscounts: hash-urile noi intra dupa cele vechi, doar daca trec filtrele, pana la limita", () => {
  const deals = new Map([["n1", deal("n1")], ["n2", deal("n2")], ["filtered", deal("filtered")], ["n3", deal("n3")]]);
  const pending = planPendingDiscounts({
    oldPending: [pendingItem("old", deal("old"), 0)],
    orderedHashes: ["n1", "n2", "filtered", "n3"],
    dealsByHash: deals,
    seenSet: new Set(),
    now: NOW,
    maxAttempts: 3,
    graceCycles: 2,
    limit: 3,
    passesFilters: d => d.title !== "filtered",
    validateSnapshot: validateAll
  });
  assert.deepEqual(pending.map(item => item.hash), ["old", "n1", "n2"], "limita opreste adaugarea, filtratul e sarit");
  assert.equal(pending[1].attempts, 0, "hash-urile noi pornesc de la 0 attempts");
});

test("planDiscountFailure: requeue sub prag cu attempts incrementat pe copie; dead-letter la prag", () => {
  const item = pendingItem("h", deal("x"), 1);
  const requeued = planDiscountFailure(item, 3);
  assert.equal(requeued.action, "requeue");
  assert.equal(requeued.action === "requeue" ? requeued.retry.attempts : -1, 2);
  assert.equal(item.attempts, 1, "itemul original nu e mutat");
  const dead = planDiscountFailure(pendingItem("h", deal("x"), 2), 3);
  assert.deepEqual(dead, { action: "dead-letter", attempts: 3 });
});
