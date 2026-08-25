"use strict";

import { updatedDocument } from "../../shared/persistenceOutcome.js";
import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type { WebhookSnapshotEntry, WebhookSnapshotRecord } from "./webhookGuardTypes.js";

export interface WebhookSnapshotModelLike {
  findOne(filter: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<WriteCounts | null | undefined>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number } | null | undefined>;
}

function asEntries(value: unknown): WebhookSnapshotEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map(entry => ({
      webhookId: String(entry.webhookId ?? ""),
      channelId: String(entry.channelId ?? ""),
      name: typeof entry.name === "string" ? entry.name : "",
      avatar: typeof entry.avatar === "string" ? entry.avatar : null,
      creatorId: typeof entry.creatorId === "string" ? entry.creatorId : null
    }))
    .filter(entry => entry.webhookId.length > 0);
}

export function createWebhookSnapshotRepository(model: WebhookSnapshotModelLike) {
  function documentId(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  async function read(guildId: string, channelId: string): Promise<WebhookSnapshotRecord | null> {
    const document = await model.findOne({ _id: documentId(guildId, channelId) }).lean();
    if (!document) return null;
    return {
      _id: String(document._id),
      guildId,
      channelId,
      entries: asEntries(document.entries),
      capturedAt: document.capturedAt instanceof Date ? document.capturedAt : new Date(0),
      ownerInterventionAt: document.ownerInterventionAt instanceof Date ? document.ownerInterventionAt : null
    };
  }

  async function write(
    guildId: string,
    channelId: string,
    entries: readonly WebhookSnapshotEntry[],
    capturedAt: Date
  ): Promise<void> {
    await model.updateOne(
      { _id: documentId(guildId, channelId) },
      { $set: { guildId, channelId, entries: [...entries], capturedAt }, $unset: { ownerInterventionAt: "" } },
      { upsert: true }
    );
  }

  async function markOwnerIntervention(guildId: string, channelId: string, at: Date): Promise<boolean> {
    const result = await model.updateOne(
      { _id: documentId(guildId, channelId), ownerInterventionAt: null },
      { $set: { ownerInterventionAt: at } }
    );
    return updatedDocument(result);
  }

  async function clear(guildId: string): Promise<void> {
    await model.deleteMany({ guildId });
  }

  return { read, write, clear, markOwnerIntervention };
}

export type WebhookSnapshotRepository = ReturnType<typeof createWebhookSnapshotRepository>;
