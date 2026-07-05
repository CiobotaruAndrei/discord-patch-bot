"use strict";

import type { CurrencyCode, ServerAuditLogEntry } from "../../types";
import { buildServerAuditPush } from "../admin-records/auditLogRepository";
import { buildResetConfiguration } from "./guildConfigDefaults";

export interface GuildConfigWriteModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
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
