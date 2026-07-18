"use strict";

export interface GuildSettingsWriteModel {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface GuildSettingsRepository {
  setField(guildId: string, field: string, value: unknown): Promise<void>;
  setFieldIfVersion(guildId: string, field: string, value: unknown, expectedVersion: number): Promise<void>;
  updateChannelLock(guildId: string, channelId: string, locked: boolean): Promise<void>;
  setGameAliases(guildId: string, aliases: Record<string, string[]>): Promise<void>;
}

export function createGuildSettingsRepository(model: GuildSettingsWriteModel, invalidate?: (guildId: string) => void): GuildSettingsRepository {
  async function write(guildId: string, update: Record<string, unknown>, expectedVersion?: number): Promise<void> {
    const filter = expectedVersion === undefined ? { _id: guildId } : { _id: guildId, settingsVersion: expectedVersion };
    const result = await model.updateOne(filter, { ...update, $inc: { settingsVersion: 1 } }, { upsert: expectedVersion === undefined });
    if (expectedVersion !== undefined && result && typeof result === "object" && "matchedCount" in result && (result as { matchedCount?: number }).matchedCount === 0) {
      throw new GuildSettingsConflictError(guildId, expectedVersion);
    }
    invalidate?.(guildId);
  }
  return {
    setField: (guildId, field, value) => write(guildId, { $set: { [field]: value } }),
    setFieldIfVersion: (guildId, field, value, expectedVersion) => write(guildId, { $set: { [field]: value } }, expectedVersion),
    updateChannelLock: (guildId, channelId, locked) => write(guildId, locked ? { $addToSet: { lockedChannelIds: channelId } } : { $pull: { lockedChannelIds: channelId } }),
    setGameAliases: (guildId, aliases) => write(guildId, { $set: { gameAliases: aliases } })
  };
}

export class GuildSettingsConflictError extends Error {
  constructor(public readonly guildId: string, public readonly expectedVersion: number) {
    super(`Setarile guildului '${guildId}' au fost modificate intre citire si scriere`);
    this.name = "GuildSettingsConflictError";
  }
}
