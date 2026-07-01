"use strict";

import type {
  BotAuditLogEntry,
  ConfigBackupRecord,
  FutureReleaseGameEntry,
  GuildSettings,
  ServerAuditLogEntry,
  SuggestedCommandEntry,
  WatchlistGameSuggestionEntry
} from "../../types";

type MongoWriteResult = { modifiedCount?: number; matchedCount?: number };

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

type FindOneAndUpdateGuildModel<TDoc> = GuildModelLike & {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<TDoc | null>;
};

type FutureReleaseGuildModel = FindOneAndUpdateGuildModel<{ futureReleaseGames?: FutureReleaseGameEntry[] }>;
type SuggestedCommandGuildModel = FindOneAndUpdateGuildModel<{ suggestedCommands?: SuggestedCommandEntry[] }>;
type WatchlistGameGuildModel = FindOneAndUpdateGuildModel<{ watchlistGameSuggestions?: WatchlistGameSuggestionEntry[] }>;

const MAX_CONFIG_BACKUPS = 20;
const MAX_BOT_AUDIT_LOGS = 100;
const MAX_SERVER_AUDIT_LOGS = 100;
const MAX_SUGGESTED_COMMANDS = 100;
const MAX_WATCHLIST_GAME_SUGGESTIONS = 100;
const MAX_FUTURE_RELEASE_GAMES = 20;

export const CONFIG_BACKUP_KEYS = [
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
  "youtubeTitleIncludeWords",
  "watchlistGameSuggestions",
  "playerCountSubscribed",
  "playerCountChannelId",
  "playerCountGames",
  "futureReleaseGames",
  "futureReleaseSubscribed",
  "futureReleaseChannelId",
  "dlcSubscribed",
  "dlcChannelId"
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

export function buildSuggestedCommandUpsertPipeline(record: SuggestedCommandEntry, maxItems: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      suggestedCommands: {
        $let: {
          vars: { existing: { $ifNull: ["$suggestedCommands", []] } },
          in: {
            $cond: [
              { $in: [record.commandName, { $map: { input: "$$existing", as: "entry", in: "$$entry.commandName" } }] },
              "$$existing",
              { $slice: [{ $concatArrays: ["$$existing", [record]] }, -maxItems] }
            ]
          }
        }
      }
    }
  }];
}

export async function saveSuggestedCommand(
  GuildModel: SuggestedCommandGuildModel,
  guildId: string,
  entry: Omit<SuggestedCommandEntry, "createdAt">
): Promise<{ record: SuggestedCommandEntry; added: boolean }> {
  const record: SuggestedCommandEntry = {
    ...entry,
    createdAt: new Date()
  };
  const before = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildSuggestedCommandUpsertPipeline(record, MAX_SUGGESTED_COMMANDS),
    { upsert: true }
  );
  const existed = (Array.isArray(before?.suggestedCommands) ? before.suggestedCommands : [])
    .some(entryItem => entryItem.commandName === record.commandName);
  return { record, added: !existed };
}

export function listSuggestedCommands(settings: GuildSettings | null, limit: number): SuggestedCommandEntry[] {
  const entries = Array.isArray(settings?.suggestedCommands) ? settings.suggestedCommands : [];
  return [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export async function deleteSuggestedCommand(GuildModel: GuildModelLike, guildId: string, name: string): Promise<boolean> {
  const normalized = name.trim().replace(/^\/+/, "").replace(/\s+/g, " ").toLowerCase();
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { suggestedCommands: { commandName: normalized } } }
  );
  return (result.modifiedCount ?? 0) > 0;
}

export function buildWatchlistGameSuggestionUpsertPipeline(record: WatchlistGameSuggestionEntry, maxItems: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      watchlistGameSuggestions: {
        $let: {
          vars: { existing: { $ifNull: ["$watchlistGameSuggestions", []] } },
          in: {
            $cond: [
              { $in: [record.gameName, { $map: { input: "$$existing", as: "entry", in: "$$entry.gameName" } }] },
              "$$existing",
              { $slice: [{ $concatArrays: ["$$existing", [record]] }, -maxItems] }
            ]
          }
        }
      }
    }
  }];
}

export async function saveWatchlistGameSuggestion(
  GuildModel: WatchlistGameGuildModel,
  guildId: string,
  entry: Omit<WatchlistGameSuggestionEntry, "createdAt">
): Promise<{ record: WatchlistGameSuggestionEntry; added: boolean }> {
  const record: WatchlistGameSuggestionEntry = {
    ...entry,
    createdAt: new Date()
  };
  const before = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildWatchlistGameSuggestionUpsertPipeline(record, MAX_WATCHLIST_GAME_SUGGESTIONS),
    { upsert: true }
  );
  const existed = (Array.isArray(before?.watchlistGameSuggestions) ? before.watchlistGameSuggestions : [])
    .some(entryItem => entryItem.gameName === record.gameName);
  return { record, added: !existed };
}

export function listWatchlistGameSuggestions(settings: GuildSettings | null, limit: number): WatchlistGameSuggestionEntry[] {
  const entries = Array.isArray(settings?.watchlistGameSuggestions) ? settings.watchlistGameSuggestions : [];
  return [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export async function deleteWatchlistGameSuggestion(GuildModel: GuildModelLike, guildId: string, gameName: string): Promise<boolean> {
  const normalized = gameName.trim().toLowerCase();
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { watchlistGameSuggestions: { gameName: normalized } } }
  );
  return (result.modifiedCount ?? 0) > 0;
}

export function buildFutureReleaseUpsertPipeline(
  record: FutureReleaseGameEntry,
  maxGames: number
): Array<Record<string, unknown>> {
  return [{
    $set: {
      futureReleaseGames: {
        $let: {
          vars: {
            kept: {
              $filter: {
                input: { $ifNull: ["$futureReleaseGames", []] },
                as: "game",
                cond: { $ne: ["$$game.gameName", record.gameName] }
              }
            }
          },
          in: {
            $cond: [
              { $lt: [{ $size: "$$kept" }, maxGames] },
              { $concatArrays: ["$$kept", [record]] },
              "$$kept"
            ]
          }
        }
      }
    }
  }];
}

export async function saveFutureReleaseGame(
  GuildModel: FutureReleaseGuildModel,
  guildId: string,
  entry: Omit<FutureReleaseGameEntry, "addedAt">
): Promise<{ record: FutureReleaseGameEntry; saved: boolean }> {
  const record: FutureReleaseGameEntry = {
    ...entry,
    addedAt: new Date()
  };
  const updated = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildFutureReleaseUpsertPipeline(record, MAX_FUTURE_RELEASE_GAMES),
    { upsert: true, new: true }
  );
  const games = Array.isArray(updated?.futureReleaseGames) ? updated.futureReleaseGames : [];
  const saved = games.some(game => game.gameName === record.gameName);
  return { record, saved };
}

export function listFutureReleaseGames(settings: GuildSettings | null): FutureReleaseGameEntry[] {
  const entries = Array.isArray(settings?.futureReleaseGames) ? settings.futureReleaseGames : [];
  return [...entries].sort((a, b) => String(a.gameName).localeCompare(String(b.gameName)));
}

export async function deleteFutureReleaseGame(GuildModel: GuildModelLike, guildId: string, gameName: string): Promise<boolean> {
  const normalized = gameName.trim().toLowerCase();
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { futureReleaseGames: { gameName: normalized } } }
  );
  return (result.modifiedCount ?? 0) > 0;
}
