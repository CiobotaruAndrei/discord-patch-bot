"use strict";

import type { GuildSettings, MongoWriteOutcome, ServerAuditLogEntry, WatchlistGameSuggestionEntry } from "../../types.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "./auditLogRepository.js";
import { matchedDocument } from "../../shared/persistenceOutcome.js";

type MongoWriteResult = MongoWriteOutcome;

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

type WatchlistGameGuildModel = GuildModelLike & {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ watchlistGameSuggestions?: WatchlistGameSuggestionEntry[] } | null>;
};

const MAX_WATCHLIST_GAME_SUGGESTIONS = 100;

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

export async function deleteWatchlistGameSuggestion(
  GuildModel: GuildModelLike,
  GuildAuditLogModel: GuildAuditLogModelLike,
  guildId: string,
  gameName: string,
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">
): Promise<boolean> {
  const normalized = gameName.trim().toLowerCase();
  const result = await GuildModel.updateOne(
    { _id: guildId, "watchlistGameSuggestions.gameName": normalized },
    { $pull: { watchlistGameSuggestions: { gameName: normalized } } }
  );
  const deleted = matchedDocument(result);
  if (deleted) await recordServerAuditEntry(GuildAuditLogModel, guildId, audit);
  return deleted;
}
