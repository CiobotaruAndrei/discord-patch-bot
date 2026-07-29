"use strict";

import type { CurrencyCode, MongoWriteOutcome, ServerAuditLogEntry } from "../../types.js";
import { recordServerAuditEntry, type GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import { buildResetConfiguration } from "./guildConfigDefaults.js";
import { clearYoutubeErrors, type YoutubeErrorModelLike } from "../youtube/youtubeErrorsRepository.js";
import { clearDeadLetters, type DeadLetterModelLike } from "../notifications/deadLetterRepository.js";
import { sequentialRunner, type TransactionRunner } from "../../shared/transactionPort.js";

export type GuildConfigWriteResult = MongoWriteOutcome;
export type LockedChannelPermissionState = "allow" | "deny" | "inherit";

export interface GuildConfigWriteModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<GuildConfigWriteResult>;
}

export async function applyGuildConfigUpdate(
  GuildModel: GuildConfigWriteModelLike,
  guildId: string,
  set: Record<string, unknown>,
  options?: { upsert?: boolean }
): Promise<GuildConfigWriteResult> {
  return GuildModel.updateOne({ _id: guildId }, { $set: set }, { upsert: options?.upsert ?? true });
}

export async function addWatchlistGame(GuildModel: GuildConfigWriteModelLike, guildId: string, gameKey: string): Promise<void> {
  await GuildModel.updateOne({ _id: guildId }, { $addToSet: { enabledGames: gameKey } }, { upsert: true });
}

export async function removeWatchlistGame(GuildModel: GuildConfigWriteModelLike, guildId: string, gameKey: string | null): Promise<GuildConfigWriteResult> {
  return GuildModel.updateOne({ _id: guildId }, { $pull: { enabledGames: gameKey } });
}

export async function setCommandSnooze(GuildModel: GuildConfigWriteModelLike, guildId: string, key: string, until: Date): Promise<void> {
  await GuildModel.updateOne({ _id: guildId }, { $set: { [`commandSnoozes.${key}`]: until } }, { upsert: true });
}

export async function clearCommandSnooze(GuildModel: GuildConfigWriteModelLike, guildId: string, key: string): Promise<void> {
  await GuildModel.updateOne({ _id: guildId }, { $unset: { [`commandSnoozes.${key}`]: "" } });
}

export async function setLockedChannel(GuildModel: GuildConfigWriteModelLike, guildId: string, channelId: string, locked: boolean): Promise<GuildConfigWriteResult> {
  const update = locked ? { $addToSet: { lockedChannelIds: channelId } } : { $pull: { lockedChannelIds: channelId } };
  return GuildModel.updateOne({ _id: guildId }, update, { upsert: true });
}

export async function setLockedChannelPermissionState(
  GuildModel: GuildConfigWriteModelLike,
  guildId: string,
  channelId: string,
  previous: LockedChannelPermissionState,
  locked: boolean
): Promise<GuildConfigWriteResult> {
  const update = locked
    ? [{
      $set: {
        lockedChannelIds: { $setUnion: [{ $ifNull: ["$lockedChannelIds", []] }, [channelId]] },
        lockedChannelPermissions: {
          $concatArrays: [
            {
              $filter: {
                input: { $ifNull: ["$lockedChannelPermissions", []] },
                as: "entry",
                cond: { $ne: ["$$entry.channelId", channelId] }
              }
            },
            [{ channelId, sendMessages: previous }]
          ]
        }
      }
    }]
    : [{
      $set: {
        lockedChannelIds: {
          $filter: {
            input: { $ifNull: ["$lockedChannelIds", []] },
            as: "lockedChannelId",
            cond: { $ne: ["$$lockedChannelId", channelId] }
          }
        },
        lockedChannelPermissions: {
          $filter: {
            input: { $ifNull: ["$lockedChannelPermissions", []] },
            as: "entry",
            cond: { $ne: ["$$entry.channelId", channelId] }
          }
        }
      }
    }];
  return GuildModel.updateOne({ _id: guildId }, update, { upsert: true });
}

export async function resetGuildConfigurationWithAudit(
  GuildModel: GuildConfigWriteModelLike,
  GuildAuditLogModel: Pick<GuildAuditLogModelLike, "create" | "updateOne">,
  GuildYoutubeErrorModel: Pick<YoutubeErrorModelLike, "deleteMany">,
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "deleteMany">,
  guildId: string,
  defaultCurrency: CurrencyCode,
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">,
  operationId: string,
  runner?: TransactionRunner
): Promise<void> {
  const run = runner ?? sequentialRunner;
  await run.atomic("reset-config", async session => {
    const options = session ? { session } : undefined;
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: buildResetConfiguration(defaultCurrency) },
      { upsert: true, ...(options ?? {}) }
    );
    await recordServerAuditEntry(GuildAuditLogModel, guildId, audit, operationId, options);
    await clearYoutubeErrors(GuildYoutubeErrorModel, guildId, options);
    await clearDeadLetters(GuildDeadLetterModel, guildId, options);
  });
}

export async function setAdminAlertChannel(
  GuildModel: GuildConfigWriteModelLike,
  guildId: string,
  channelId: string | null
): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    { $set: { adminAlertChannelId: channelId } },
    { upsert: true }
  );
}
