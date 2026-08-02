"use strict";

import { MASS_MODERATION_WINDOW_MS, withinWindow } from "./massModerationTypes.js";
import { updatedDocument } from "../../shared/persistenceOutcome.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type { MassModerationAction, MassModerationEvent, MassModerationWindow } from "./massModerationTypes.js";

export interface MassModerationModelLike {
  findOne(filter: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<WriteCounts | null | undefined>;
}

function asEvents(value: unknown): MassModerationEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map(entry => ({
      auditId: String(entry.auditId ?? ""),
      targetId: String(entry.targetId ?? ""),
      action: (entry.action === "ban" ? "ban" : "kick") as MassModerationAction,
      at: entry.at instanceof Date ? entry.at : new Date(String(entry.at ?? 0))
    }))
    .filter(event => event.targetId.length > 0 && Number.isFinite(event.at.getTime()));
}

export function createMassModerationRepository(model: MassModerationModelLike) {
  function documentId(guildId: string, actorId: string): string {
    return `${guildId}:${actorId}`;
  }

  async function read(guildId: string, actorId: string): Promise<MassModerationWindow | null> {
    const document = await model.findOne({ _id: documentId(guildId, actorId) }).lean();
    if (!document) return null;
    return {
      _id: String(document._id),
      guildId,
      actorId,
      events: asEvents(document.events),
      sanctionedAt: document.sanctionedAt instanceof Date ? document.sanctionedAt : null
    };
  }

  async function record(
    guildId: string,
    actorId: string,
    event: { auditId: string; targetId: string; action: MassModerationAction },
    now: Date
  ): Promise<MassModerationWindow> {
    const existing = await read(guildId, actorId);
    const previous = withinWindow(existing?.events ?? [], now);
    const alreadySeen = event.auditId.length > 0 && previous.some(entry => entry.auditId === event.auditId);
    const events = alreadySeen ? previous : [...previous, { ...event, at: now }];
    const sanctionedAt = existing?.sanctionedAt && existing.sanctionedAt.getTime() > now.getTime() - MASS_MODERATION_WINDOW_MS
      ? existing.sanctionedAt
      : null;

    await model.updateOne(
      { _id: documentId(guildId, actorId) },
      { $set: { guildId, actorId, events, sanctionedAt, updatedAt: now } },
      { upsert: true }
    );

    return { _id: documentId(guildId, actorId), guildId, actorId, events, sanctionedAt };
  }

  async function claimSanction(guildId: string, actorId: string, now: Date): Promise<boolean> {
    const cutoff = new Date(now.getTime() - MASS_MODERATION_WINDOW_MS);
    const result = await model.updateOne(
      { _id: documentId(guildId, actorId), $or: [{ sanctionedAt: null }, { sanctionedAt: { $lte: cutoff } }] },
      { $set: { sanctionedAt: now } }
    );
    return updatedDocument(result);
  }

  async function clear(guildId: string, actorId: string): Promise<void> {
    await model.updateOne(
      { _id: documentId(guildId, actorId) },
      { $set: { events: [], sanctionedAt: null } }
    );
  }

  return { read, record, claimSanction, clear };
}

export type MassModerationRepository = ReturnType<typeof createMassModerationRepository>;
