"use strict";

import type { GuildAuditLogModelLike, GuildAuditLogRecord } from "../admin-records/auditLogRepository.js";
import type { BotObservationEvent } from "./botObservationAggregator.js";

export interface BotObservationRepository {
  record(event: BotObservationEvent): Promise<void>;
  loadRecent(guildId: string, since: number, limit?: number): Promise<BotObservationEvent[]>;
}

function observationDetails(event: BotObservationEvent): string {
  return JSON.stringify({ eventId: event.id, subjectId: event.subjectId, at: event.at, details: event.details });
}

function parseObservation(doc: GuildAuditLogRecord): BotObservationEvent | null {
  if (doc.kind !== "bot" || !doc.command?.startsWith("observation:")) return null;
  let parsed: { eventId?: unknown; subjectId?: unknown; at?: unknown; details?: unknown } = {};
  try {
    const candidate: unknown = JSON.parse(doc.details || "{}");
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) parsed = candidate as typeof parsed;
  } catch {
    return null;
  }
  const kindValue = doc.command.slice("observation:".length);
  if (kindValue !== "new-account" && kindValue !== "threat" && kindValue !== "bot-add" && kindValue !== "moderation") return null;
  const eventId = typeof parsed.eventId === "string" ? parsed.eventId : doc.operationId;
  const at = typeof parsed.at === "number" ? parsed.at : doc.at instanceof Date ? doc.at.getTime() : Number(new Date(doc.at || 0));
  if (!eventId || !Number.isFinite(at)) return null;
  const event: BotObservationEvent = {
    id: eventId,
    guildId: doc.guildId,
    kind: kindValue,
    at
  };
  if (typeof parsed.subjectId === "string") event.subjectId = parsed.subjectId;
  if (typeof parsed.details === "string") event.details = parsed.details;
  return event;
}

export function createBotObservationRepository(model: GuildAuditLogModelLike): BotObservationRepository {
  async function record(event: BotObservationEvent): Promise<void> {
    const document: GuildAuditLogRecord = {
      operationId: event.id,
      guildId: event.guildId,
      kind: "bot",
      command: `observation:${event.kind}`,
      details: observationDetails(event),
      at: new Date(event.at)
    };
    if (model.updateOne) {
      await model.updateOne({ operationId: event.id }, { $setOnInsert: document }, { upsert: true });
      return;
    }
    await model.create(document);
  }

  async function loadRecent(guildId: string, since: number, limit = 500): Promise<BotObservationEvent[]> {
    const docs = await model.find({ guildId, kind: "bot", command: { $regex: "^observation:" }, at: { $gte: new Date(since) } })
      .sort({ at: -1 })
      .limit(Math.max(1, Math.min(2_000, limit)))
      .lean();
    return docs.map(parseObservation).filter((event): event is BotObservationEvent => event !== null);
  }

  return Object.freeze({ record, loadRecent });
}

export default { createBotObservationRepository };
