"use strict";

export interface GuildSettingsWriteModel {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface GuildSettingsRepository {
  setField(guildId: string, field: string, value: unknown): Promise<void>;
  updateChannelLock(guildId: string, channelId: string, locked: boolean): Promise<void>;
  setGameAliases(guildId: string, aliases: Record<string, string[]>): Promise<void>;
}

export function createGuildSettingsRepository(model: GuildSettingsWriteModel, invalidate?: (guildId: string) => void): GuildSettingsRepository {
  async function write(guildId: string, update: Record<string, unknown>): Promise<void> {
    await model.updateOne({ _id: guildId }, update, { upsert: true });
    invalidate?.(guildId);
  }
  return {
    setField: (guildId, field, value) => write(guildId, { $set: { [field]: value } }),
    updateChannelLock: (guildId, channelId, locked) => write(guildId, locked ? { $addToSet: { lockedChannelIds: channelId } } : { $pull: { lockedChannelIds: channelId } }),
    setGameAliases: (guildId, aliases) => write(guildId, { $set: { gameAliases: aliases } })
  };
}
