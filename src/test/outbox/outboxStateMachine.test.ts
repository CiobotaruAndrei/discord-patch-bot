import test from "node:test";
import assert from "node:assert/strict";

import type { OutboxJob } from "../../features/notifications/outboxTypes.js";
import { backoffWithJitter, createOutboxStateMachine, type OutboxStateMachineDeps } from "../../features/notifications/outboxStateMachine.js";

function makeJob(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    kind: "update",
    guildId: "guild-1",
    channelId: "channel-1",
    payload: { content: "mesaj" },
    attempts: 0,
    dedupeKey: "cheie-dedupe",
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    ...overrides
  } as OutboxJob;
}

function makeDeps(overrides: Partial<OutboxStateMachineDeps> = {}): OutboxStateMachineDeps & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    alreadySent: async () => false,
    maxAgeMs: 0,
    now: () => new Date("2026-07-01T12:00:00.000Z"),
    logger: (level, _context, message) => {
      if (level === "WARN") warnings.push(message);
    },
    ...overrides
  };
}

test("validateClaimedJob verifica in ordine: duplicat -> expirare -> abonare -> payload -> livrare", async () => {
  const duplicate = createOutboxStateMachine(makeDeps({ alreadySent: async () => true, maxAgeMs: 1 }));
  assert.deepEqual(await duplicate.validateClaimedJob(makeJob({ payload: "corupt" })), { step: "drop-duplicate" });

  const expired = createOutboxStateMachine(makeDeps({
    maxAgeMs: 60 * 60 * 1000,
    isStillSubscribed: async () => false
  }));
  assert.deepEqual(await expired.validateClaimedJob(makeJob({ payload: "corupt" })), { step: "expire" });

  const unsubscribed = createOutboxStateMachine(makeDeps({ isStillSubscribed: async () => false }));
  assert.deepEqual(await unsubscribed.validateClaimedJob(makeJob({ payload: "corupt" })), { step: "drop-unsubscribed" });

  const badPayload = createOutboxStateMachine(makeDeps({ isStillSubscribed: async () => true }));
  assert.deepEqual(await badPayload.validateClaimedJob(makeJob({ payload: "corupt" })), { step: "dead-letter", reason: "invalid-payload" });

  const deliverable = createOutboxStateMachine(makeDeps());
  assert.deepEqual(await deliverable.validateClaimedJob(makeJob()), { step: "deliver" });
});

test("validateClaimedJob amana livrarea cu retry cand verificarea abonarii arunca", async () => {
  const deps = makeDeps({
    isStillSubscribed: async () => {
      throw new Error("mongo indisponibil");
    }
  });
  const machine = createOutboxStateMachine(deps);

  assert.deepEqual(await machine.validateClaimedJob(makeJob()), { step: "retry", reason: "subscription-check-failed" });
  assert.equal(deps.warnings.length, 1);
});

test("backoffWithJitter ramane intre 50% si 150% din baza inmultita cu incercarile, plafonat la 30 de minute", () => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const value = backoffWithJitter(1000, attempt);
    assert.ok(value >= 1000 * attempt * 0.5 - 1, `sub limita inferioara la incercarea ${attempt}`);
    assert.ok(value <= 1000 * attempt * 1.5 + 1, `peste limita superioara la incercarea ${attempt}`);
  }
  const capped = backoffWithJitter(30 * 60 * 1000, 100);
  assert.ok(capped <= 45 * 60 * 1000);
});
