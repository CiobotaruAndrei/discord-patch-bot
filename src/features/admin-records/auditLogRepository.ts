"use strict";

import type { BotAuditLogEntry, ServerAuditLogEntry } from "../../types.js";

export interface GuildAuditLogRecord {
  operationId?: string;
  guildId: string;
  kind: "bot" | "server";
  userId?: string;
  actorId?: string;
  targetId?: string;
  command?: string;
  action?: string;
  result?: string;
  details?: string;
  at?: Date | string;
}

export interface GuildAuditLogQueryLike {
  sort(spec: Record<string, 1 | -1>): GuildAuditLogQueryLike;
  skip(count: number): GuildAuditLogQueryLike;
  limit(count: number): GuildAuditLogQueryLike;
  lean(): Promise<GuildAuditLogRecord[]>;
}

export interface GuildAuditLogModelLike {
  create(doc: GuildAuditLogRecord): Promise<unknown>;
  updateOne?(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  find(filter: Record<string, unknown>): GuildAuditLogQueryLike;
}

function toDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toBotEntry(doc: GuildAuditLogRecord): BotAuditLogEntry {
  return {
    serverId: doc.guildId,
    userId: doc.userId || "",
    command: doc.command || "",
    result: doc.result || "",
    details: doc.details || "",
    at: toDate(doc.at)
  };
}

function toServerEntry(doc: GuildAuditLogRecord): ServerAuditLogEntry {
  const actorId = doc.actorId || doc.userId || "";
  return {
    serverId: doc.guildId,
    userId: actorId,
    actorId,
    targetId: doc.targetId || "",
    action: doc.action || "",
    details: doc.details || "",
    at: toDate(doc.at)
  };
}

async function listByKind(
  model: GuildAuditLogModelLike,
  guildId: string,
  kind: "bot" | "server",
  limit: number,
  offset: number,
  range?: { start: Date; end: Date }
): Promise<GuildAuditLogRecord[]> {
  const filter: Record<string, unknown> = { guildId, kind };
  if (range) filter.at = { $gte: range.start, $lt: range.end };
  return model.find(filter)
    .sort({ at: -1 })
    .skip(Math.max(0, offset))
    .limit(Math.max(0, limit))
    .lean();
}

export async function recordBotAuditEntry(
  model: GuildAuditLogModelLike,
  guildId: string,
  entry: Omit<BotAuditLogEntry, "serverId" | "at">
): Promise<void> {
  await model.create({
    guildId,
    kind: "bot",
    userId: entry.userId || "",
    command: entry.command,
    result: entry.result,
    details: entry.details || "",
    at: new Date()
  });
}

export async function recordServerAuditEntry(
  model: GuildAuditLogModelLike,
  guildId: string,
  entry: Omit<ServerAuditLogEntry, "serverId" | "at">,
  operationId?: string
): Promise<void> {
  const actorId = entry.actorId || entry.userId || "";
  const document: GuildAuditLogRecord = {
    operationId,
    guildId,
    kind: "server",
    userId: actorId,
    actorId,
    targetId: entry.targetId || "",
    action: entry.action,
    details: entry.details || "",
    at: new Date()
  };
  if (operationId && model.updateOne) {
    await model.updateOne(
      { operationId },
      { $setOnInsert: document },
      { upsert: true }
    );
    return;
  }
  await model.create(document);
}

export async function listBotAuditEntries(model: GuildAuditLogModelLike, guildId: string, limit: number): Promise<BotAuditLogEntry[]> {
  const docs = await listByKind(model, guildId, "bot", limit, 0);
  return docs.map(toBotEntry);
}

export async function listBotAuditEntriesInRange(
  model: GuildAuditLogModelLike,
  guildId: string,
  start: Date,
  end: Date,
  limit: number,
  offset = 0
): Promise<BotAuditLogEntry[]> {
  const docs = await listByKind(model, guildId, "bot", limit, offset, { start, end });
  return docs.map(toBotEntry);
}

export async function listServerAuditEntries(model: GuildAuditLogModelLike, guildId: string, limit: number): Promise<ServerAuditLogEntry[]> {
  const docs = await listByKind(model, guildId, "server", limit, 0);
  return docs.map(toServerEntry);
}

export async function listServerAuditEntriesInRange(
  model: GuildAuditLogModelLike,
  guildId: string,
  start: Date,
  end: Date,
  limit: number,
  offset = 0
): Promise<ServerAuditLogEntry[]> {
  const docs = await listByKind(model, guildId, "server", limit, offset, { start, end });
  return docs.map(toServerEntry);
}
