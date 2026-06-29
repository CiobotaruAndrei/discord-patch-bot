"use strict";

import type {
  BotAuditLogEntry,
  ConfigBackupRecord,
  GuildSettings,
  ServerAuditLogEntry,
  SuggestedCommandEntry
} from "../../types";

type MongoWriteResult = { modifiedCount?: number; matchedCount?: number };

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

const MAX_CONFIG_BACKUPS = 20;
const MAX_BOT_AUDIT_LOGS = 100;
const MAX_SERVER_AUDIT_LOGS = 100;
const MAX_SUGGESTED_COMMANDS = 100;

const CONFIG_BACKUP_KEYS = [
  "subscribed",
  "notificationChannelId",
  "discountsSubscribed",
  "discountChannelId",
  "minDiscountPercent",
  "includeFreeGames",
  "includePaidDiscounts",
  "notificationMode",
  "currency",
  "outboxRecoveryVerify",
  "enabledGames",
  "commandSnoozes",
  "enabledStores",
  "maxAbsolutePrice",
  "notificationRoleId",
  "discountRoleId",
  "adminAlertChannelId",
  "priceAlerts",
  "youtubeChannels",
  "youtubeNotificationChannelId",
  "youtubeNotificationsEnabled",
  "youtubeHasActivated",
  "youtubeFilters",
  "youtubeMessageTemplate",
  "youtubeChannelRoutes",
  "youtubeTitleIncludeWords"
] as const;

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (!serialized) return {};
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function normalizeBackupName(value: string): string {
  return value.trim().replace(/\s+/g, "-").toLowerCase().slice(0, 64);
}

export function buildConfigSnapshot(settings: GuildSettings | null): Record<string, unknown> {
  const source = settings ?? { _id: "" };
  const snapshot: Record<string, unknown> = {};
  for (const key of CONFIG_BACKUP_KEYS) {
    const value = source[key];
    if (value !== undefined) snapshot[key] = value;
  }
  return cloneRecord(snapshot);
}

export function findBackup(settings: GuildSettings | null, name: string): ConfigBackupRecord | null {
  const normalized = normalizeBackupName(name);
  const backups = Array.isArray(settings?.configBackups) ? settings.configBackups : [];
  return backups.find(backup => normalizeBackupName(backup.name) === normalized) ?? null;
}

export function listBackups(settings: GuildSettings | null): ConfigBackupRecord[] {
  const backups = Array.isArray(settings?.configBackups) ? settings.configBackups : [];
  return [...backups].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function saveConfigBackup(
  GuildModel: GuildModelLike,
  guildId: string,
  name: string,
  createdBy: string,
  settings: GuildSettings | null
): Promise<ConfigBackupRecord> {
  const normalized = normalizeBackupName(name);
  const record: ConfigBackupRecord = {
    name: normalized,
    createdBy,
    createdAt: new Date(),
    snapshot: buildConfigSnapshot(settings)
  };
  await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { configBackups: { name: normalized } } },
    { upsert: true }
  );
  await GuildModel.updateOne(
    { _id: guildId },
    { $push: { configBackups: { $each: [record], $slice: -MAX_CONFIG_BACKUPS } } },
    { upsert: true }
  );
  return record;
}

export function buildConfigRestoreUpdate(backup: ConfigBackupRecord): Record<string, unknown> {
  const snapshot = backup.snapshot ?? {};
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  for (const key of CONFIG_BACKUP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key) && snapshot[key] !== undefined) {
      set[key] = snapshot[key];
    } else {
      unset[key] = "";
    }
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

export async function loadConfigBackup(
  GuildModel: GuildModelLike,
  guildId: string,
  backup: ConfigBackupRecord
): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    buildConfigRestoreUpdate(backup),
    { upsert: true }
  );
}

export async function deleteConfigBackup(GuildModel: GuildModelLike, guildId: string, name: string): Promise<boolean> {
  const normalized = normalizeBackupName(name);
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { configBackups: { name: normalized } } }
  );
  return (result.modifiedCount ?? 0) > 0;
}

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

export async function recordServerAuditEntry(
  GuildModel: GuildModelLike,
  guildId: string,
  entry: Omit<ServerAuditLogEntry, "serverId" | "at">
): Promise<void> {
  const record: ServerAuditLogEntry = {
    ...entry,
    serverId: guildId,
    at: new Date()
  };
  await GuildModel.updateOne(
    { _id: guildId },
    { $push: { serverAuditLog: { $each: [record], $slice: -MAX_SERVER_AUDIT_LOGS } } },
    { upsert: true }
  );
}

export function listServerAuditEntries(settings: GuildSettings | null, limit: number): ServerAuditLogEntry[] {
  const entries = Array.isArray(settings?.serverAuditLog) ? settings.serverAuditLog : [];
  return [...entries]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

export async function saveSuggestedCommand(
  GuildModel: GuildModelLike,
  guildId: string,
  entry: Omit<SuggestedCommandEntry, "createdAt">
): Promise<SuggestedCommandEntry> {
  const record: SuggestedCommandEntry = {
    ...entry,
    createdAt: new Date()
  };
  await GuildModel.updateOne(
    { _id: guildId },
    { $push: { suggestedCommands: { $each: [record], $slice: -MAX_SUGGESTED_COMMANDS } } },
    { upsert: true }
  );
  return record;
}

export function listSuggestedCommands(settings: GuildSettings | null, limit: number): SuggestedCommandEntry[] {
  const entries = Array.isArray(settings?.suggestedCommands) ? settings.suggestedCommands : [];
  return [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

