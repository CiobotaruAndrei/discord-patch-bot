"use strict";

import type { CurrencyCode, ServerAuditLogEntry } from "../../types";
import { buildServerAuditPush } from "../admin-records/auditLogRepository";
import { buildResetConfiguration } from "./guildConfigDefaults";

export interface GuildConfigWriteResult { matchedCount?: number; modifiedCount?: number }

export interface GuildConfigWriteModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<GuildConfigWriteResult>;
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

export async function resetGuildConfigurationWithAudit(
  GuildModel: GuildConfigWriteModelLike,
  guildId: string,
  defaultCurrency: CurrencyCode,
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">
): Promise<void> {
  await GuildModel.updateOne(
    { _id: guildId },
    {
      $set: buildResetConfiguration(defaultCurrency),
      $push: buildServerAuditPush(guildId, audit)
    },
    { upsert: true }
  );
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
