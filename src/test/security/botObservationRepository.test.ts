import test from "node:test";
import assert from "node:assert/strict";

import {
  recordBotObservationEvent,
  startBotObservation,
  type BotObservationRecord
} from "../../features/command-security/botObservationRepository.js";

function observation(at: Date, eventCount: number): BotObservationRecord {
  return {
    botId: "bot-1",
    requesterId: "user-1",
    approval: "one-time",
    initialRisk: "suspicious",
    joinedAt: at,
    observeUntil: new Date(at.getTime() + 86_400_000),
    lastActivityAt: at,
    eventKeys: Array.from({ length: eventCount }, (_, index) => `event-${index}`),
    recentEvents: Array.from({ length: eventCount }, (_, index) => ({
      key: `event-${index}`,
      kind: "role-permissions",
      at: new Date(at.getTime() - index * 1000),
      confirmed: true
    })),
    lastBurstAlertAt: null
  };
}

test("pornirea observatiei actualizeaza contextul existent sau creeaza unul persistent", async () => {
  const updates: object[] = [];
  let call = 0;
  const model = {
    findOne: async () => null,
    findOneAndUpdate: async () => null,
    updateOne: async (_filter: object, update: object) => {
      updates.push(update);
      call++;
      return { modifiedCount: call === 1 ? 0 : 1 };
    }
  };
  const at = new Date("2026-07-18T10:00:00.000Z");

  await startBotObservation(model, "guild-1", {
    botId: "bot-1",
    requesterId: "user-1",
    approval: "one-time",
    initialRisk: "suspicious",
    joinedAt: at
  });

  assert.equal(updates.length, 2);
  assert.ok(Reflect.has(updates[1], "$push"));
});

test("evenimentele duplicate sunt ignorate dupa restart pe baza cheii persistate", async () => {
  const at = new Date("2026-07-18T10:00:00.000Z");
  const model = {
    findOne: async () => ({ botObservations: [observation(at, 1)] }),
    findOneAndUpdate: async () => null,
    updateOne: async () => ({ modifiedCount: 0 })
  };

  const result = await recordBotObservationEvent(model, "guild-1", "bot-1", {
    key: "event-0",
    kind: "role-permissions",
    at,
    confirmed: true
  });

  assert.equal(result.observed, true);
  assert.equal(result.duplicate, true);
});

test("cinci actiuni intr-un minut revendica o singura alerta agregata", async () => {
  const at = new Date("2026-07-18T10:00:00.000Z");
  let call = 0;
  const model = {
    findOne: async () => ({ botObservations: [observation(at, 5)] }),
    findOneAndUpdate: async () => null,
    updateOne: async () => {
      call++;
      return { modifiedCount: 1 };
    }
  };

  const result = await recordBotObservationEvent(model, "guild-1", "bot-1", {
    key: "event-5",
    kind: "webhook-change",
    at,
    confirmed: true
  });

  assert.equal(result.recentCount, 5);
  assert.equal(result.burstStarted, true);
  assert.equal(call, 2);
});
