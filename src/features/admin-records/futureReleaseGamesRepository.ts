"use strict";

import type { FutureReleaseGameEntry, GuildSettings, MongoWriteOutcome } from "../../types";

type MongoWriteResult = MongoWriteOutcome;

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

type FutureReleaseGuildModel = GuildModelLike & {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ futureReleaseGames?: FutureReleaseGameEntry[] } | null>;
};

const MAX_FUTURE_RELEASE_GAMES = 20;

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

export async function startFutureReleaseNotifications(
  GuildModel: GuildModelLike,
  guildId: string,
  channelId: string,
  activationId: string
): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    {
      $set: {
        futureReleaseSubscribed: true,
        futureReleaseChannelId: channelId,
        futureReleaseInitializing: false,
        futureReleaseActivationId: activationId
      }
    },
    { upsert: true }
  );
}

export async function stopFutureReleaseNotifications(GuildModel: GuildModelLike, guildId: string): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    {
      $set: {
        futureReleaseSubscribed: false,
        futureReleaseChannelId: null,
        futureReleaseInitializing: false
      },
      $unset: { futureReleaseActivationId: "" }
    }
  );
}
