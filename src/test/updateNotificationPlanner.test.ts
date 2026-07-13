import test from "node:test";
import assert from "node:assert/strict";

import {
  planPendingFailure,
  planRebaselineEntries,
  requeueFront,
  takeNextPending
} from "../features/notifications/updateNotificationPlanner.js";
import type { PendingUpdate, UpdateFetchResult } from "../features/notifications/pendingUpdatesQueue.js";

function rotateAfter<T>(arr: T[], lastSeen: T | null): T[] {
  if (lastSeen == null) return arr;
  const index = arr.indexOf(lastSeen);
  if (index === -1) return arr;
  return [...arr.slice(index + 1), ...arr.slice(0, index + 1)];
}

function pending(id: string, attempts = 0): PendingUpdate {
  return { id, title: `t-${id}`, link: `l-${id}`, attempts, queuedAt: new Date().toISOString() } as PendingUpdate;
}

test("planRebaselineEntries: deriva perechile gameKey/updateId doar din rezultatele cu latest", () => {
  const results = new Map<string, UpdateFetchResult>([
    ["cs2", { game: { key: "cs2", name: "CS2" }, latest: { id: "u1" }, error: null } as UpdateFetchResult],
    ["dota", { game: { key: "dota", name: "Dota" }, latest: null, error: "boom" } as UpdateFetchResult]
  ]);
  assert.deepEqual(planRebaselineEntries(results), [{ gameKey: "cs2", updateId: "u1" }]);
});

test("takeNextPending: round-robin dupa lastProcessedGameKey, scoate itemul si sterge cozile golite", () => {
  const queues = new Map<string, PendingUpdate[]>([
    ["a", [pending("a1")]],
    ["b", [pending("b1"), pending("b2")]]
  ]);
  const first = takeNextPending(queues, "a", rotateAfter);
  assert.equal(first?.gameKey, "b", "dupa a urmeaza b (round-robin)");
  assert.equal(first?.item.id, "b1");
  const second = takeNextPending(queues, "b", rotateAfter);
  assert.equal(second?.gameKey, "a");
  assert.ok(!queues.has("a"), "coada golita e stearsa din map");
  const third = takeNextPending(queues, "a", rotateAfter);
  assert.equal(third?.gameKey, "b");
  assert.equal(third?.item.id, "b2");
  assert.equal(takeNextPending(queues, "b", rotateAfter), null, "toate cozile goale => null");
});

test("planPendingFailure: incrementeaza attempts si decide requeue sub prag / dead-letter la prag", () => {
  const item = pending("x", 0);
  assert.deepEqual(planPendingFailure(item, 3), { action: "requeue", attempts: 1 });
  assert.equal(item.attempts, 1, "attempts e incrementat de decizie, ca in fluxul original");
  assert.deepEqual(planPendingFailure(item, 3), { action: "requeue", attempts: 2 });
  assert.deepEqual(planPendingFailure(item, 3), { action: "dead-letter", attempts: 3 });
  assert.equal(item.attempts, 3);
});

test("requeueFront: itemul reintra in fata cozii lui", () => {
  const queues = new Map<string, PendingUpdate[]>([["a", [pending("a2")]]]);
  requeueFront(queues, "a", pending("a1"));
  requeueFront(queues, "b", pending("b1"));
  assert.deepEqual((queues.get("a") || []).map(item => item.id), ["a1", "a2"]);
  assert.deepEqual((queues.get("b") || []).map(item => item.id), ["b1"], "coada inexistenta e creata");
});
