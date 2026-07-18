"use strict";

import type { ModerationGuildModel } from "../moderation/moderationRepository.js";

export interface BotObservationEvent {
  key: string;
  kind: string;
  at: Date;
  confirmed: boolean;
}

export interface BotObservationRecord {
  botId: string;
  requesterId: string;
  approval: "owner" | "one-time" | "unapproved-removal-failed";
  initialRisk: "normal" | "suspicious" | "dangerous";
  joinedAt: Date;
  observeUntil: Date;
  lastActivityAt: Date;
  eventKeys: string[];
  recentEvents: BotObservationEvent[];
  lastBurstAlertAt: Date | null;
}

export type BotObservationModelLike = ModerationGuildModel;

export interface StartBotObservationInput {
  botId: string;
  requesterId: string;
  approval: BotObservationRecord["approval"];
  initialRisk: BotObservationRecord["initialRisk"];
  joinedAt: Date;
}

export interface RecordedObservationEvent {
  observed: boolean;
  duplicate: boolean;
  recentCount: number;
  burstStarted: boolean;
}

const OBSERVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BURST_WINDOW_MS = 60_000;
const BURST_THRESHOLD = 5;
const MAX_EVENTS = 64;

function modifiedCount(result: object | null | undefined): number {
  if (!result) return 0;
  const value = Reflect.get(result, "modifiedCount");
  return typeof value === "number" ? value : 0;
}

async function resolveDocument(value: ReturnType<ModerationGuildModel["findOne"]>): Promise<object | null> {
  const lean = Reflect.get(value, "lean");
  if (typeof lean === "function") return Promise.resolve(lean.call(value));
  return Promise.resolve(value);
}

export async function startBotObservation(
  model: BotObservationModelLike,
  guildId: string,
  input: StartBotObservationInput
): Promise<void> {
  const observeUntil = new Date(input.joinedAt.getTime() + OBSERVATION_WINDOW_MS);
  const reset = {
    requesterId: input.requesterId,
    approval: input.approval,
    initialRisk: input.initialRisk,
    joinedAt: input.joinedAt,
    observeUntil,
    lastActivityAt: input.joinedAt,
    eventKeys: [],
    recentEvents: [],
    lastBurstAlertAt: null
  };
  const existing = await model.updateOne(
    { _id: guildId, "botObservations.botId": input.botId },
    { $set: Object.fromEntries(Object.entries(reset).map(([key, value]) => [`botObservations.$[entry].${key}`, value])) },
    { arrayFilters: [{ "entry.botId": input.botId }] }
  );
  if (modifiedCount(existing) > 0) return;
  await model.updateOne(
    { _id: guildId, botObservations: { $not: { $elemMatch: { botId: input.botId } } } },
    { $push: { botObservations: { botId: input.botId, ...reset } } }
  );
}

function observedRecord(document: object | null, botId: string): BotObservationRecord | null {
  const records = document ? Reflect.get(document, "botObservations") : null;
  if (!Array.isArray(records)) return null;
  const record = records.find(entry => entry && typeof entry === "object" && Reflect.get(entry, "botId") === botId);
  if (!record || typeof record !== "object") return null;
  const recentEvents = Reflect.get(record, "recentEvents");
  const observeUntil = Reflect.get(record, "observeUntil");
  return {
    botId,
    requesterId: String(Reflect.get(record, "requesterId") ?? ""),
    approval: Reflect.get(record, "approval"),
    initialRisk: Reflect.get(record, "initialRisk"),
    joinedAt: new Date(Reflect.get(record, "joinedAt")),
    observeUntil: new Date(observeUntil),
    lastActivityAt: new Date(Reflect.get(record, "lastActivityAt")),
    eventKeys: Array.isArray(Reflect.get(record, "eventKeys")) ? Reflect.get(record, "eventKeys") : [],
    recentEvents: Array.isArray(recentEvents) ? recentEvents : [],
    lastBurstAlertAt: Reflect.get(record, "lastBurstAlertAt") ? new Date(Reflect.get(record, "lastBurstAlertAt")) : null
  };
}

export async function recordBotObservationEvent(
  model: BotObservationModelLike,
  guildId: string,
  botId: string,
  event: BotObservationEvent
): Promise<RecordedObservationEvent> {
  const inserted = await model.updateOne(
    {
      _id: guildId,
      botObservations: {
        $elemMatch: {
          botId,
          observeUntil: { $gt: event.at },
          eventKeys: { $ne: event.key }
        }
      }
    },
    {
      $set: { "botObservations.$[entry].lastActivityAt": event.at },
      $push: {
        "botObservations.$[entry].eventKeys": { $each: [event.key], $slice: -MAX_EVENTS },
        "botObservations.$[entry].recentEvents": { $each: [event], $slice: -MAX_EVENTS }
      }
    },
    { arrayFilters: [{ "entry.botId": botId, "entry.observeUntil": { $gt: event.at } }] }
  );
  const document = await resolveDocument(model.findOne({ _id: guildId, "botObservations.botId": botId }));
  const observation = observedRecord(document, botId);
  if (!observation || observation.observeUntil.getTime() <= event.at.getTime()) {
    return { observed: false, duplicate: false, recentCount: 0, burstStarted: false };
  }
  if (modifiedCount(inserted) === 0) {
    return { observed: true, duplicate: true, recentCount: 0, burstStarted: false };
  }
  const cutoff = event.at.getTime() - BURST_WINDOW_MS;
  const recentCount = observation.recentEvents.filter(item => new Date(item.at).getTime() >= cutoff).length;
  if (recentCount < BURST_THRESHOLD) {
    return { observed: true, duplicate: false, recentCount, burstStarted: false };
  }
  const claimed = await model.updateOne(
    {
      _id: guildId,
      botObservations: {
        $elemMatch: {
          botId,
          observeUntil: { $gt: event.at },
          $or: [{ lastBurstAlertAt: null }, { lastBurstAlertAt: { $lt: new Date(cutoff) } }]
        }
      }
    },
    { $set: { "botObservations.$[entry].lastBurstAlertAt": event.at } },
    { arrayFilters: [{ "entry.botId": botId }] }
  );
  return {
    observed: true,
    duplicate: false,
    recentCount,
    burstStarted: modifiedCount(claimed) > 0
  };
}

export default { startBotObservation, recordBotObservationEvent };
