"use strict";

import type { MongoWriteOutcome, ServerAuditLogEntry, SuggestedCommandEntry } from "../../types.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "./auditLogRepository.js";
import { createdDocument } from "../../shared/persistenceOutcome.js";

export interface GuildSuggestedCommandRecord {
  guildId: string;
  commandName: string;
  description?: string;
  createdBy?: string;
  createdAt?: Date | string;
}

export interface SuggestedCommandQueryLike {
  sort(spec: Record<string, 1 | -1>): SuggestedCommandQueryLike;
  skip(count: number): SuggestedCommandQueryLike;
  limit(count: number): SuggestedCommandQueryLike;
  lean(): Promise<GuildSuggestedCommandRecord[]>;
}

export interface SuggestedCommandModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteOutcome>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  find(filter: Record<string, unknown>): SuggestedCommandQueryLike;
}

export const MAX_SUGGESTED_COMMANDS = 100;

function toEntryDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toEntry(doc: GuildSuggestedCommandRecord): SuggestedCommandEntry {
  return {
    commandName: doc.commandName,
    description: doc.description || "",
    createdBy: doc.createdBy || "",
    createdAt: toEntryDate(doc.createdAt)
  };
}

export async function saveSuggestedCommand(
  model: Pick<SuggestedCommandModelLike, "updateOne" | "find" | "deleteMany">,
  guildId: string,
  entry: Omit<SuggestedCommandEntry, "createdAt">
): Promise<{ record: SuggestedCommandEntry; added: boolean }> {
  const record: SuggestedCommandEntry = {
    ...entry,
    createdAt: new Date()
  };
  const result = await model.updateOne(
    { guildId, commandName: record.commandName },
    { $setOnInsert: { description: record.description, createdBy: record.createdBy, createdAt: record.createdAt } },
    { upsert: true }
  );
  const added = createdDocument(result);
  if (added) {
    const overflow = await model.find({ guildId }).sort({ createdAt: -1 }).skip(MAX_SUGGESTED_COMMANDS).limit(MAX_SUGGESTED_COMMANDS).lean();
    if (overflow.length > 0) {
      await model.deleteMany({ guildId, commandName: { $in: overflow.map(doc => doc.commandName) } });
    }
  }
  return { record, added };
}

export async function listSuggestedCommands(
  model: Pick<SuggestedCommandModelLike, "find">,
  guildId: string,
  limit: number
): Promise<SuggestedCommandEntry[]> {
  const docs = await model.find({ guildId }).sort({ createdAt: -1 }).skip(0).limit(Math.max(0, limit)).lean();
  return docs.map(toEntry);
}

export async function deleteSuggestedCommand(
  model: Pick<SuggestedCommandModelLike, "deleteOne">,
  GuildAuditLogModel: GuildAuditLogModelLike,
  guildId: string,
  name: string,
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">
): Promise<boolean> {
  const normalized = name.trim().replace(/^\/+/, "").replace(/\s+/g, " ").toLowerCase();
  const result = await model.deleteOne({ guildId, commandName: normalized });
  const deleted = (result.deletedCount ?? 0) > 0;
  if (deleted) await recordServerAuditEntry(GuildAuditLogModel, guildId, audit);
  return deleted;
}
