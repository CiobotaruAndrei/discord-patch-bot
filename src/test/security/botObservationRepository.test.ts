import test from "node:test";
import assert from "node:assert/strict";

import {
  recordBotObservationEvent,
  startBotObservation,
  observeConfirmedBotAction,
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

test("observeConfirmedBotAction: cheie 'audit:<id>' confirmata + alerta de rafala pe prag (audit, #6)", async () => {
  const at = new Date("2026-07-18T10:00:00.000Z");
  const record = observation(at, 6);
  record.recentEvents = record.recentEvents.map((event, index) => ({ ...event, key: `audit:e${index}`, kind: "server-channel-created", at: new Date(at.getTime() - index * 1000) }));
  const pushedEvents: Array<{ key?: string; kind?: string; confirmed?: boolean }> = [];
  const model = {
    findOne: () => ({ lean: async () => ({ botObservations: [record] }) }),
    findOneAndUpdate: async () => null,
    updateOne: async (_filter: object, update: Record<string, unknown>) => {
      const push = Reflect.get(update, "$push");
      const events = push && typeof push === "object" ? Reflect.get(push, "botObservations.$[entry].recentEvents") : null;
      const each = events && typeof events === "object" ? Reflect.get(events, "$each") : null;
      if (Array.isArray(each) && each.length > 0) pushedEvents.push(each[0] as { key?: string; kind?: string; confirmed?: boolean });
      return { modifiedCount: 1 };
    }
  };
  const alerts: Array<{ kind: string; guildId?: string }> = [];
  const result = await observeConfirmedBotAction(
    model,
    async (kind, _title, _body, guildId) => { alerts.push({ kind, guildId }); },
    "guild-1", "bot-1", "e9", "server-channel-created", new Date(at.getTime() + 500)
  );
  assert.equal(result?.burstStarted, true, "6 actiuni corelate intr-un minut declanseaza incidentul agregat");
  assert.equal(pushedEvents[0]?.key, "audit:e9", "evenimentul de observatie e cheiat pe audit entry ID (dedup intre runtime-uri)");
  assert.equal(pushedEvents[0]?.confirmed, true);
  assert.deepEqual(alerts, [{ kind: "security:bot-observation-burst", guildId: "guild-1" }]);
});

test("observeConfirmedBotAction: fara actor sau fara audit entry ID nu inregistreaza nimic (audit, #6)", async () => {
  let called = false;
  const model = {
    findOne: () => ({ lean: async () => null }),
    findOneAndUpdate: async () => null,
    updateOne: async () => { called = true; return { modifiedCount: 0 }; }
  };
  const noActor = await observeConfirmedBotAction(model, async () => undefined, "guild-1", "", "e1", "k", new Date());
  const noAudit = await observeConfirmedBotAction(model, async () => undefined, "guild-1", "bot-1", "", "k", new Date());
  assert.equal(noActor, null);
  assert.equal(noAudit, null);
  assert.equal(called, false, "fara actor/audit nu se atinge Mongo");
});
