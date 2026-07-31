"use strict";

import { createdDocument, updatedDocument } from "../../shared/persistenceOutcome.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";

export interface PlayerCountWatchRecord {
  guildId: string;
  gameKey: string;
  appId: string;
  playerCount: number;
  fetchedAt: Date;
  lastNotifiedAt?: Date | null;
  lastDirection?: "up" | "down" | null;
}

export interface PlayerCountWatchModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<PlayerCountWatchRecord[]> };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<WriteCounts | null | undefined>;
  deleteMany?(filter: Record<string, unknown>): Promise<unknown>;
}

export interface ClaimedWatchUpdate {
  playerCount: number;
  fetchedAt: Date;
  appId: string;
  notifiedDirection?: "up" | "down" | null;
}

export function createPlayerCountWatchRepository(model: PlayerCountWatchModelLike) {
  async function listForGuilds(guildIds: readonly string[], gameKey: string): Promise<Map<string, PlayerCountWatchRecord>> {
    const byGuild = new Map<string, PlayerCountWatchRecord>();
    if (guildIds.length === 0) return byGuild;
    for (const record of await model.find({ guildId: { $in: [...guildIds] }, gameKey }).lean()) {
      byGuild.set(record.guildId, record);
    }
    return byGuild;
  }

  async function startWatching(record: PlayerCountWatchRecord): Promise<boolean> {
    const result = await model.updateOne(
      { guildId: record.guildId, gameKey: record.gameKey },
      {
        $setOnInsert: {
          guildId: record.guildId,
          gameKey: record.gameKey,
          appId: record.appId,
          playerCount: record.playerCount,
          fetchedAt: record.fetchedAt,
          lastNotifiedAt: null,
          lastDirection: null
        }
      },
      { upsert: true }
    );
    return createdDocument(result);
  }

  async function claimObservation(
    guildId: string,
    gameKey: string,
    previous: { playerCount: number; fetchedAt: Date },
    next: ClaimedWatchUpdate
  ): Promise<boolean> {
    const set: Record<string, unknown> = {
      appId: next.appId,
      playerCount: next.playerCount,
      fetchedAt: next.fetchedAt
    };
    if (next.notifiedDirection) {
      set.lastNotifiedAt = next.fetchedAt;
      set.lastDirection = next.notifiedDirection;
    }
    const result = await model.updateOne(
      { guildId, gameKey, playerCount: previous.playerCount, fetchedAt: previous.fetchedAt },
      { $set: set }
    );
    return updatedDocument(result);
  }

  return { listForGuilds, startWatching, claimObservation };
}

export type PlayerCountWatchRepository = ReturnType<typeof createPlayerCountWatchRepository>;
