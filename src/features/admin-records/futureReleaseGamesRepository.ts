"use strict";

import type { FutureReleaseGameEntry, GuildSettings, MongoWriteOutcome } from "../../types.js";

type MongoWriteResult = MongoWriteOutcome;

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

export type FutureReleaseGuildModel = GuildModelLike & {
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
    addedAt: new Date(),
    sourceAppId: "",
    baselineDone: false,
    notifiedThresholdDays: [],
    preorderSeen: false,
    observedPreorderPrice: null,
    stateRevision: 0,
    lastCheckedAt: null
  };
  const updated = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildFutureReleaseUpsertPipeline(record, MAX_FUTURE_RELEASE_GAMES),
    { upsert: true, returnDocument: "after" }
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
  await GuildModel.updateOne({ _id: guildId }, [{
    $set: {
      futureReleaseSubscribed: true,
      futureReleaseChannelId: channelId,
      futureReleaseInitializing: true,
      futureReleaseActivationId: activationId,
      futureReleaseGames: {
        $map: {
          input: { $ifNull: ["$futureReleaseGames", []] },
          as: "game",
          in: {
            $mergeObjects: ["$$game", {
              baselineDone: false,
              notifiedThresholdDays: [],
              preorderSeen: false,
              observedPreorderPrice: null,
              stateRevision: 0,
              lastCheckedAt: null
            }]
          }
        }
      }
    }
  }], { upsert: true });
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

export interface FutureReleaseStateUpdate {
  baselineDone: boolean;
  notifiedThresholdDays: number[];
  preorderSeen: boolean;
  observedPreorderPrice: string | null;
  sourceAppId?: string;
  releaseDate?: string | null;
  preorderPrice?: string | null;
}

export async function persistFutureReleaseState(
  GuildModel: GuildModelLike,
  guildId: string,
  activationId: string,
  gameName: string,
  state: FutureReleaseStateUpdate,
  checkedAt: Date
): Promise<boolean> {
  const result = await GuildModel.updateOne(
    {
      _id: guildId,
      futureReleaseSubscribed: true,
      futureReleaseActivationId: activationId,
      "futureReleaseGames.gameName": gameName
    },
    [{
      $set: {
        futureReleaseGames: {
          $map: {
            input: { $ifNull: ["$futureReleaseGames", []] },
            as: "game",
            in: {
              $cond: [
                { $eq: ["$$game.gameName", gameName] },
                {
                  $mergeObjects: ["$$game", {
                    baselineDone: state.baselineDone,
                    notifiedThresholdDays: state.notifiedThresholdDays,
                    preorderSeen: state.preorderSeen,
                    observedPreorderPrice: state.observedPreorderPrice,
                    sourceAppId: state.sourceAppId ?? "$$game.sourceAppId",
                    releaseDate: state.releaseDate ?? "$$game.releaseDate",
                    preorderPrice: state.preorderPrice ?? "",
                    stateRevision: { $add: [{ $ifNull: ["$$game.stateRevision", 0] }, 1] },
                    lastCheckedAt: checkedAt
                  }]
                },
                "$$game"
              ]
            }
          }
        }
      }
    }]
  );
  return (result.modifiedCount ?? 0) > 0;
}

export async function finishFutureReleaseInitialization(
  GuildModel: GuildModelLike,
  guildId: string,
  activationId: string
): Promise<boolean> {
  const result = await GuildModel.updateOne(
    {
      _id: guildId,
      futureReleaseSubscribed: true,
      futureReleaseInitializing: true,
      futureReleaseActivationId: activationId
    },
    { $set: { futureReleaseInitializing: false } }
  );
  return (result.modifiedCount ?? 0) > 0;
}

export async function disableFutureReleaseForChannelError(
  GuildModel: GuildModelLike,
  guildId: string,
  channelId: string
): Promise<MongoWriteResult> {
  return GuildModel.updateOne(
    { _id: guildId, futureReleaseChannelId: channelId },
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
