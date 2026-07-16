"use strict";

export type ModerationRecord = {
  schemaVersion?: number;
  userId: string;
  username: string;
  moderatorId: string;
  appliedAt: Date;
  expiresAt?: Date | null;
  reason?: string;
};

export type WarningRecord = {
  schemaVersion?: number;
  userId: string;
  username: string;
  moderatorId: string;
  warnedAt: Date;
  reason?: string;
};

type ModerationGuildModel = {
  findOne(filter: { _id: string }): { lean(): Promise<Record<string, unknown> | null> } | Promise<Record<string, unknown> | null>;
  updateOne(filter: { _id: string }, update: Record<string, unknown>, options?: { upsert?: boolean }): Promise<unknown>;
};

type GuildModerationState = {
  moderationTimeouts?: ModerationRecord[];
  moderationMutes?: ModerationRecord[];
  moderationWarnings?: WarningRecord[];
  moderationWarnBanLimit?: number;
};

function hasLean(value: unknown): value is { lean(): Promise<Record<string, unknown> | null> } {
  return Boolean(value && typeof (value as { lean?: unknown }).lean === "function");
}

async function readGuild(model: ModerationGuildModel, guildId: string): Promise<GuildModerationState> {
  const result = model.findOne({ _id: guildId });
  const document = hasLean(result) ? await result.lean() : await result;
  return (document ?? {}) as GuildModerationState;
}

function active(records: readonly ModerationRecord[] | undefined, now = Date.now()): ModerationRecord[] {
  return (records ?? []).filter(record => !record.expiresAt || new Date(record.expiresAt).getTime() > now);
}

export async function getModerationState(model: ModerationGuildModel, guildId: string): Promise<GuildModerationState> {
  const state = await readGuild(model, guildId);
  return {
    moderationTimeouts: active(state.moderationTimeouts),
    moderationMutes: active(state.moderationMutes),
    moderationWarnings: state.moderationWarnings ?? [],
    moderationWarnBanLimit: state.moderationWarnBanLimit ?? 0
  };
}

export async function saveTimeout(model: ModerationGuildModel, guildId: string, record: ModerationRecord): Promise<void> {
  const state = await getModerationState(model, guildId);
  await model.updateOne({ _id: guildId }, { $set: {
    moderationTimeouts: [...(state.moderationTimeouts ?? []).filter(item => item.userId !== record.userId), record],
    moderationMutes: (state.moderationMutes ?? []).filter(item => item.userId !== record.userId)
  } }, { upsert: true });
}

export async function saveMute(model: ModerationGuildModel, guildId: string, record: ModerationRecord): Promise<void> {
  const state = await getModerationState(model, guildId);
  await model.updateOne({ _id: guildId }, { $set: {
    moderationMutes: [...(state.moderationMutes ?? []).filter(item => item.userId !== record.userId), record],
    moderationTimeouts: (state.moderationTimeouts ?? []).filter(item => item.userId !== record.userId)
  } }, { upsert: true });
}

export async function removeModeration(model: ModerationGuildModel, guildId: string, field: "moderationTimeouts" | "moderationMutes", userId: string): Promise<boolean> {
  const state = await getModerationState(model, guildId);
  const records = state[field] ?? [];
  const found = records.some(item => item.userId === userId);
  if (found) await model.updateOne({ _id: guildId }, { $set: { [field]: records.filter(item => item.userId !== userId) } }, { upsert: true });
  return found;
}

export async function addWarning(model: ModerationGuildModel, guildId: string, record: WarningRecord): Promise<{ count: number; limit: number }> {
  const state = await getModerationState(model, guildId);
  const warnings = [...(state.moderationWarnings ?? []), record];
  await model.updateOne({ _id: guildId }, { $set: { moderationWarnings: warnings } }, { upsert: true });
  return { count: warnings.filter(item => item.userId === record.userId).length, limit: state.moderationWarnBanLimit ?? 0 };
}

export async function removeWarning(model: ModerationGuildModel, guildId: string, userId: string): Promise<number> {
  const state = await getModerationState(model, guildId);
  const warnings = [...(state.moderationWarnings ?? [])];
  const index = warnings.map(item => item.userId).lastIndexOf(userId);
  if (index >= 0) warnings.splice(index, 1);
  await model.updateOne({ _id: guildId }, { $set: { moderationWarnings: warnings } }, { upsert: true });
  return warnings.filter(item => item.userId === userId).length;
}

export async function setWarnBanLimit(model: ModerationGuildModel, guildId: string, limit: number): Promise<void> {
  await model.updateOne({ _id: guildId }, { $set: { moderationWarnBanLimit: limit } }, { upsert: true });
}

export default { getModerationState, saveTimeout, saveMute, removeModeration, addWarning, removeWarning, setWarnBanLimit };
