"use strict";

import type { BotAuditLogEntry, GuildSettings, ServerAuditLogEntry } from "../../types";

type MongoWriteResult = { modifiedCount?: number; matchedCount?: number };

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

const MAX_BOT_AUDIT_LOGS = 100;
const MAX_SERVER_AUDIT_LOGS = 100;

export async function recordBotAuditEntry(
  GuildModel: GuildModelLike,
  guildId: string,
  entry: Omit<BotAuditLogEntry, "serverId" | "at">
): Promise<void> {
  const record: BotAuditLogEntry = {
    ...entry,
    serverId: guildId,
    at: new Date()
  };
  await GuildModel.updateOne(
    { _id: guildId },
    { $push: { botAuditLog: { $each: [record], $slice: -MAX_BOT_AUDIT_LOGS } } },
    { upsert: true }
  );
}

export function listBotAuditEntries(settings: GuildSettings | null, limit: number): BotAuditLogEntry[] {
  const entries = Array.isArray(settings?.botAuditLog) ? settings.botAuditLog : [];
  return [...entries]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

export function listBotAuditEntriesInRange(settings: GuildSettings | null, start: Date, end: Date, limit: number, offset = 0): BotAuditLogEntry[] {
  const entries = Array.isArray(settings?.botAuditLog) ? settings.botAuditLog : [];
  return [...entries]
    .filter(entry => {
      const at = new Date(entry.at).getTime();
      return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(Math.max(0, offset), Math.max(0, offset) + limit);
}

export function buildServerAuditPush(
  guildId: string,
  entry: Omit<ServerAuditLogEntry, "serverId" | "at">
): Record<string, unknown> {
  const record: ServerAuditLogEntry = {
    ...entry,
    serverId: guildId,
    at: new Date()
  };
  return { serverAuditLog: { $each: [record], $slice: -MAX_SERVER_AUDIT_LOGS } };
}

export async function recordServerAuditEntry(
  GuildModel: GuildModelLike,
  guildId: string,
  entry: Omit<ServerAuditLogEntry, "serverId" | "at">
): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $push: buildServerAuditPush(guildId, entry) },
    { upsert: true }
  );
}

export function listServerAuditEntries(settings: GuildSettings | null, limit: number): ServerAuditLogEntry[] {
  const entries = Array.isArray(settings?.serverAuditLog) ? settings.serverAuditLog : [];
  return [...entries]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

export function listServerAuditEntriesInRange(settings: GuildSettings | null, start: Date, end: Date, limit: number, offset = 0): ServerAuditLogEntry[] {
  const entries = Array.isArray(settings?.serverAuditLog) ? settings.serverAuditLog : [];
  return [...entries]
    .filter(entry => {
      const at = new Date(entry.at).getTime();
      return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(Math.max(0, offset), Math.max(0, offset) + limit);
}
