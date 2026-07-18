import test from "node:test";
import assert from "node:assert/strict";
import { transitionModeration } from "../../features/moderation/moderationStateMachine.js";

test("moderation aggregate enforces timeout/mute exclusivity and last-warning removal", () => {
  const base = { moderationTimeouts: [], moderationMutes: [], moderationWarnings: [] };
  const record = { userId: "u1", username: "u", moderatorId: "m", appliedAt: new Date() };
  const timeout = transitionModeration(base, { type: "timeout", record });
  const mute = transitionModeration(timeout, { type: "mute", record });
  assert.equal(mute.moderationTimeouts.length, 0);
  assert.equal(mute.moderationMutes.length, 1);
  const warning = { userId: "u1", username: "u", moderatorId: "m", warnedAt: new Date(), reason: "x" };
  const warned = transitionModeration(transitionModeration(mute, { type: "warn", record: warning }), { type: "warn", record: { ...warning, reason: "y" } });
  assert.equal(transitionModeration(warned, { type: "remove-warn", userId: "u1" }).moderationWarnings.length, 1);
});
