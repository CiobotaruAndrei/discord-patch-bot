"use strict";

import type { ConfigBackupRecord, GuildSettings } from "../../types";

type MongoWriteResult = { modifiedCount?: number; matchedCount?: number };

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

const MAX_CONFIG_BACKUPS = 20;

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
  currency: "config",
  outboxRecoveryVerify: "config",
  enabledGames: "config",
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
  botAuditLog: "operational",
  serverAuditLog: "operational",
  suggestedCommands: "operational",
  configBackups: "operational",
  notificationDeadLetter: "operational",
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
  futureReleaseInitializing: "operational",
  futureReleaseActivationId: "operational",
  youtubeErrors: "operational"
});

export const CONFIG_BACKUP_KEYS: readonly string[] = Object.freeze(
  Object.entries(GUILD_SETTINGS_FIELD_ROLES)
    .filter(([, role]) => role === "config")
    .map(([field]) => field)
);

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
    [{
      $set: {
        configBackups: {
          $let: {
            vars: {
              kept: {
                $filter: {
                  input: { $ifNull: ["$configBackups", []] },
                  as: "backup",
                  cond: { $ne: ["$$backup.name", normalized] }
                }
              }
            },
            in: { $slice: [{ $concatArrays: ["$$kept", [record]] }, -MAX_CONFIG_BACKUPS] }
          }
        }
      }
    }],
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
