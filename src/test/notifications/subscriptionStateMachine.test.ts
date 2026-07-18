import test from "node:test";
import assert from "node:assert/strict";
import { transitionSubscription } from "../../features/notifications/subscriptionStateMachine.js";

test("subscription lifecycle accepts only the current activation", () => {
  const beginning = transitionSubscription({ state: "inactive" }, { type: "begin", activationId: "a1" });
  assert.deepEqual(beginning.next, { state: "initializing", activationId: "a1" });
  assert.equal(transitionSubscription(beginning.next, { type: "finalize", activationId: "stale" }).accepted, false);
  const active = transitionSubscription(beginning.next, { type: "finalize", activationId: "a1" });
  assert.deepEqual(active.next, { state: "active" });
  assert.equal(transitionSubscription(active.next, { type: "fail", activationId: "a1" }).accepted, false);
});

test("stop is idempotent and clears the activation", () => {
  assert.deepEqual(
    transitionSubscription({ state: "initializing", activationId: "a1" }, { type: "stop" }).next,
    { state: "inactive" }
  );
});
