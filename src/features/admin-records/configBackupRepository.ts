"use strict";

import type { MongoWriteOutcome } from "../../types.js";
import { sequentialRunner, type TransactionRunner } from "../../shared/transactionPort.js";
import type { ConfigBackupRecord, ServerAuditLogEntry } from "./adminRecordsTypes.js";
import type { GuildConfigurationSettings, GuildSettings } from "../guild-config/guildSettingsTypes.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "./auditLogRepository.js";

type MongoWriteResult = MongoWriteOutcome;

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

export interface GuildConfigBackupRecord {
  guildId: string;
  name: string;
  createdBy?: string;
  createdAt?: Date | string;
  snapshot?: Record<string, unknown>;
}

export interface ConfigBackupQueryLike {
  sort(spec: Record<string, 1 | -1>): ConfigBackupQueryLike;
  skip(count: number): ConfigBackupQueryLike;
  limit(count: number): ConfigBackupQueryLike;
  lean(): Promise<GuildConfigBackupRecord[]>;
}

export interface ConfigBackupFindOneLike {
  lean(): Promise<GuildConfigBackupRecord | null>;
}

export interface ConfigBackupModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteResult>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  find(filter: Record<string, unknown>): ConfigBackupQueryLike;
  findOne(filter: Record<string, unknown>): ConfigBackupFindOneLike;
}

export const MAX_CONFIG_BACKUPS = 20;

export type GuildSettingsFieldRole = "config" | "security" | "operational";

export const GUILD_SETTINGS_FIELD_ROLES: Readonly<Record<string, GuildSettingsFieldRole>> = Object.freeze({
  subscribed: "config",
  notificationChannelId: "config",
  discountsSubscribed: "config",
  discountChannelId: "config",
  minDiscountPercent: "config",
  includeFreeGames: "config",
  includePaidDiscounts: "config",
  notificationMode: "config",
  updateMessageTemplate: "config",
  discountMessageTemplate: "config",
  currency: "config",
  outboxRecoveryVerify: "config",
  enabledGames: "config",
  gameAliases: "config",
  timezone: "config",
  commandSnoozes: "config",
  enabledStores: "config",
  maxAbsolutePrice: "config",
  notificationRoleId: "config",
  discountRoleId: "config",
  adminAlertChannelId: "config",
  priceAlerts: "config",
  youtubeChannels: "config",
  youtubeNotificationChannelId: "config",
  youtubeNotificationsEnabled: "config",
  youtubeHasActivated: "config",
  youtubeFilters: "config",
  youtubeMessageTemplate: "config",
  youtubeChannelRoutes: "config",
  youtubeTitleIncludeWords: "config",
  watchlistGameSuggestions: "config",
  playerCountSubscribed: "config",
  playerCountChannelId: "config",
  playerCountGames: "config",
  futureReleaseGames: "config",
  futureReleaseSubscribed: "config",
  futureReleaseChannelId: "config",
  dlcSubscribed: "config",
  dlcChannelId: "config",
  adminCommandAccess: "security",
  adminCommandAccessByCommand: "security",
  moderationTimeouts: "security",
  moderationMutes: "security",
  moderationWarnings: "security",
  moderationWarnBanLimit: "security",
  newAccountAlertChannelId: "security",
  newAccountAlertsEnabled: "security",
  threatAlertChannelId: "security",
  threatProtectionEnabled: "security",
  botAddAlertChannelId: "security",
  botAddProtectionEnabled: "security",
  warningChannelId: "security",
  botAddPermissions: "operational",
  purgeAmount: "security",
  lockedChannelIds: "security",
  lockedChannelPermissions: "security",
  pendingUpdates: "operational",
  pendingDiscounts: "operational",
  lastProcessedGameKey: "operational",
  seenHashVersionUpdates: "operational",
  seenHashVersionDiscounts: "operational",
  updatesInitializing: "operational",
  updatesActivationId: "operational",
  updatesLastError: "operational",
  discountsInitializing: "operational",
  discountsActivationId: "operational",
  discountsLastError: "operational",
  dlcInitializing: "operational",
  dlcActivationId: "operational",
  dlcLastError: "operational",
  futureReleaseInitializing: "operational",
  futureReleaseActivationId: "operational",
  playerCountInitializing: "operational",
  playerCountActivationId: "operational",
  playerCountWatchState: "operational",
  botObservations: "operational"
});

export const CONFIG_BACKUP_KEYS: readonly (keyof GuildConfigurationSettings)[] = Object.freeze([
  "subscribed", "notificationChannelId", "discountsSubscribed", "discountChannelId",
  "minDiscountPercent", "includeFreeGames", "includePaidDiscounts", "notificationMode",
  "updateMessageTemplate", "discountMessageTemplate", "currency", "outboxRecoveryVerify",
  "enabledGames", "gameAliases", "timezone", "commandSnoozes", "enabledStores",
  "maxAbsolutePrice", "notificationRoleId", "discountRoleId", "adminAlertChannelId",
  "priceAlerts", "youtubeChannels", "youtubeNotificationChannelId", "youtubeNotificationsEnabled",
  "youtubeHasActivated", "youtubeFilters", "youtubeMessageTemplate", "youtubeChannelRoutes",
  "youtubeTitleIncludeWords", "watchlistGameSuggestions", "playerCountSubscribed",
  "playerCountChannelId", "playerCountGames", "futureReleaseGames", "futureReleaseSubscribed",
  "futureReleaseChannelId", "dlcSubscribed", "dlcChannelId"
]);

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

function toBackupDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toBackupRecord(doc: GuildConfigBackupRecord): ConfigBackupRecord {
  return {
    name: doc.name,
    createdBy: doc.createdBy || "",
    createdAt: toBackupDate(doc.createdAt),
    snapshot: doc.snapshot ?? {}
  };
}

export async function findConfigBackup(model: Pick<ConfigBackupModelLike, "findOne">, guildId: string, name: string): Promise<ConfigBackupRecord | null> {
  const normalized = normalizeBackupName(name);
  const doc = await model.findOne({ guildId, name: normalized }).lean();
  return doc ? toBackupRecord(doc) : null;
}

export async function listConfigBackups(model: Pick<ConfigBackupModelLike, "find">, guildId: string): Promise<ConfigBackupRecord[]> {
  const docs = await model.find({ guildId }).sort({ createdAt: -1 }).skip(0).limit(MAX_CONFIG_BACKUPS).lean();
  return docs.map(toBackupRecord);
}

export async function findNewestConfigBackup(model: Pick<ConfigBackupModelLike, "find">, guildId: string): Promise<ConfigBackupRecord | null> {
  const docs = await model.find({ guildId }).sort({ createdAt: -1 }).skip(0).limit(1).lean();
  return docs.length > 0 ? toBackupRecord(docs[0]) : null;
}

export async function saveConfigBackup(
  model: Pick<ConfigBackupModelLike, "updateOne" | "find" | "deleteMany">,
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
  await saveConfigBackupRecord(model, guildId, record);
  return record;
}

export async function saveConfigBackupRecord(
  model: Pick<ConfigBackupModelLike, "updateOne" | "find" | "deleteMany">,
  guildId: string,
  record: ConfigBackupRecord
): Promise<void> {
  await model.updateOne(
    { guildId, name: record.name },
    { $set: { createdBy: record.createdBy, createdAt: record.createdAt, snapshot: record.snapshot } },
    { upsert: true }
  );
  const overflow = await model.find({ guildId }).sort({ createdAt: -1 }).skip(MAX_CONFIG_BACKUPS).limit(MAX_CONFIG_BACKUPS).lean();
  if (overflow.length > 0) {
    await model.deleteMany({ guildId, name: { $in: overflow.map(doc => doc.name) } });
  }
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

export async function loadConfigBackupWithAudit(
  GuildModel: GuildModelLike,
  GuildAuditLogModel: GuildAuditLogModelLike,
  guildId: string,
  backup: ConfigBackupRecord,
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">,
  operationId?: string,
  runner?: TransactionRunner
): Promise<void> {
  const run = runner ?? sequentialRunner;
  await run.atomic("backup-load", async session => {
    const options = session ? { session } : undefined;
    await GuildModel.updateOne({ _id: guildId }, buildConfigRestoreUpdate(backup), { upsert: true, ...(options ?? {}) });
    await recordServerAuditEntry(GuildAuditLogModel, guildId, audit, operationId, options);
  });
}

export async function deleteConfigBackup(model: Pick<ConfigBackupModelLike, "deleteOne">, guildId: string, name: string): Promise<boolean> {
  const normalized = normalizeBackupName(name);
  const result = await model.deleteOne({ guildId, name: normalized });
  return (result.deletedCount ?? 0) > 0;
}

export async function deleteConfigBackupWithAudit(
  model: Pick<ConfigBackupModelLike, "deleteOne">,
  GuildAuditLogModel: GuildAuditLogModelLike,
  guildId: string,
  name: string,
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">,
  operationId?: string
): Promise<boolean> {
  const deleted = await deleteConfigBackup(model, guildId, name);
  if (deleted || operationId) await recordServerAuditEntry(GuildAuditLogModel, guildId, audit, operationId);
  return deleted;
}
