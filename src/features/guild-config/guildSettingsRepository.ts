"use strict";

import { GUILD_SETTINGS_FIELDS, type GuildSettingsField } from "./guildAggregate.js";

export interface GuildSettingsWriteModel {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface GuildSettingsRepository {
  setField(guildId: string, field: GuildSettingsField, value: unknown): Promise<void>;
  setFieldIfVersion(guildId: string, field: GuildSettingsField, value: unknown, expectedVersion: number): Promise<void>;
  updateChannelLock(guildId: string, channelId: string, locked: boolean, previousSendMessages?: boolean | null): Promise<void>;
  setGameAliases(guildId: string, aliases: Record<string, string[]>): Promise<void>;
}

export function createGuildSettingsRepository(model: GuildSettingsWriteModel, invalidate?: (guildId: string) => void): GuildSettingsRepository {
  function assertField(field: GuildSettingsField): void {
    if (!GUILD_SETTINGS_FIELDS.has(field)) throw new Error(`Camp GuildSettings necunoscut: ${String(field)}`);
  }

  async function write(guildId: string, update: Record<string, unknown>, expectedVersion?: number): Promise<void> {
    const filter = expectedVersion === undefined ? { _id: guildId } : { _id: guildId, settingsVersion: expectedVersion };
    const result = await model.updateOne(filter, { ...update, $inc: { settingsVersion: 1 } }, { upsert: expectedVersion === undefined });
    if (expectedVersion !== undefined && result && typeof result === "object" && "matchedCount" in result && (result as { matchedCount?: number }).matchedCount === 0) {
      throw new GuildSettingsConflictError(guildId, expectedVersion);
    }
    invalidate?.(guildId);
  }
  return {
    setField: async (guildId, field, value) => { assertField(field); await write(guildId, { $set: { [field]: value } }); },
    setFieldIfVersion: async (guildId, field, value, expectedVersion) => { assertField(field); await write(guildId, { $set: { [field]: value } }, expectedVersion); },
    updateChannelLock: (guildId, channelId, locked, previousSendMessages = null) => locked
      ? write(guildId, {
        $addToSet: { lockedChannelIds: channelId },
        ...(previousSendMessages === null ? {} : { $set: { [`lockedChannelPreviousSendMessages.${channelId}`]: previousSendMessages } })
      })
      : write(guildId, { $pull: { lockedChannelIds: channelId }, $unset: { [`lockedChannelPreviousSendMessages.${channelId}`]: 1 } }),
    setGameAliases: (guildId, aliases) => write(guildId, { $set: { gameAliases: aliases } })
  };
}

export class GuildSettingsConflictError extends Error {
  constructor(public readonly guildId: string, public readonly expectedVersion: number) {
    super(`Setarile guildului '${guildId}' au fost modificate intre citire si scriere`);
    this.name = "GuildSettingsConflictError";
  }
}
