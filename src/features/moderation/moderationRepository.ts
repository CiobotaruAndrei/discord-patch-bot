"use strict";
import { transitionModeration } from "./moderationStateMachine.js";

export type ModerationRecord = {
  userId: string;
  username: string;
  moderatorId: string;
  appliedAt: Date;
  expiresAt?: Date | null;
  reason?: string;
};

export type WarningRecord = {
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

export function reconcileModerationState(state: GuildModerationState, activeUserIds: Iterable<string>, now = Date.now()): GuildModerationState {
  const present = new Set(activeUserIds);
  const filter = (records: ModerationRecord[] | undefined) => (records ?? []).filter(record => present.has(record.userId) && (!record.expiresAt || new Date(record.expiresAt).getTime() > now));
  const timeouts = filter(state.moderationTimeouts);
  const timeoutIds = new Set(timeouts.map(record => record.userId));
  return {
    moderationTimeouts: timeouts,
    moderationMutes: filter(state.moderationMutes).filter(record => !timeoutIds.has(record.userId)),
    moderationWarnings: state.moderationWarnings ?? [],
    moderationWarnBanLimit: state.moderationWarnBanLimit ?? 0
  };
}

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
  const next = transitionModeration({ moderationTimeouts: state.moderationTimeouts ?? [], moderationMutes: state.moderationMutes ?? [], moderationWarnings: state.moderationWarnings ?? [] }, { type: "timeout", record });
  await model.updateOne({ _id: guildId }, { $set: { moderationTimeouts: next.moderationTimeouts, moderationMutes: next.moderationMutes } }, { upsert: true });
}

export async function saveMute(model: ModerationGuildModel, guildId: string, record: ModerationRecord): Promise<void> {
  const state = await getModerationState(model, guildId);
  const next = transitionModeration({ moderationTimeouts: state.moderationTimeouts ?? [], moderationMutes: state.moderationMutes ?? [], moderationWarnings: state.moderationWarnings ?? [] }, { type: "mute", record });
  await model.updateOne({ _id: guildId }, { $set: { moderationMutes: next.moderationMutes, moderationTimeouts: next.moderationTimeouts } }, { upsert: true });
}

export async function removeModeration(model: ModerationGuildModel, guildId: string, field: "moderationTimeouts" | "moderationMutes", userId: string): Promise<boolean> {
  const state = await getModerationState(model, guildId);
  const records = state[field] ?? [];
  const found = records.some(item => item.userId === userId);
  if (found) {
    const state = await getModerationState(model, guildId);
    const next = transitionModeration({ moderationTimeouts: state.moderationTimeouts ?? [], moderationMutes: state.moderationMutes ?? [], moderationWarnings: state.moderationWarnings ?? [] }, { type: field === "moderationTimeouts" ? "remove-timeout" : "remove-mute", userId });
    await model.updateOne({ _id: guildId }, { $set: { [field]: field === "moderationTimeouts" ? next.moderationTimeouts : next.moderationMutes } }, { upsert: true });
  }
  return found;
}

export async function addWarning(model: ModerationGuildModel, guildId: string, record: WarningRecord): Promise<{ count: number; limit: number }> {
  const state = await getModerationState(model, guildId);
  const warnings = transitionModeration({ moderationTimeouts: state.moderationTimeouts ?? [], moderationMutes: state.moderationMutes ?? [], moderationWarnings: state.moderationWarnings ?? [] }, { type: "warn", record }).moderationWarnings;
  await model.updateOne({ _id: guildId }, { $set: { moderationWarnings: warnings } }, { upsert: true });
  return { count: warnings.filter(item => item.userId === record.userId).length, limit: state.moderationWarnBanLimit ?? 0 };
}

export async function removeWarning(model: ModerationGuildModel, guildId: string, userId: string): Promise<number> {
  const state = await getModerationState(model, guildId);
  const warnings = transitionModeration({ moderationTimeouts: state.moderationTimeouts ?? [], moderationMutes: state.moderationMutes ?? [], moderationWarnings: state.moderationWarnings ?? [] }, { type: "remove-warn", userId }).moderationWarnings;
  await model.updateOne({ _id: guildId }, { $set: { moderationWarnings: warnings } }, { upsert: true });
  return warnings.filter(item => item.userId === userId).length;
}

export async function setWarnBanLimit(model: ModerationGuildModel, guildId: string, limit: number): Promise<void> {
  await model.updateOne({ _id: guildId }, { $set: { moderationWarnBanLimit: limit } }, { upsert: true });
}

export async function setWarnBanLimitWithPrevious(model: ModerationGuildModel, guildId: string, limit: number): Promise<{ previous: number; next: number }> {
  const state = await getModerationState(model, guildId);
  await setWarnBanLimit(model, guildId, limit);
  return { previous: state.moderationWarnBanLimit ?? 0, next: limit };
}

export async function removeModerationWithOpposite(model: ModerationGuildModel, guildId: string, field: "moderationTimeouts" | "moderationMutes", userId: string): Promise<{ removed: boolean; opposite: boolean }> {
  const state = await getModerationState(model, guildId);
  const records = state[field] ?? [];
  const oppositeField = field === "moderationTimeouts" ? "moderationMutes" : "moderationTimeouts";
  const opposite = (state[oppositeField] ?? []).some(item => item.userId === userId);
  const found = records.some(item => item.userId === userId);
  if (found) await model.updateOne({ _id: guildId }, { $set: { [field]: records.filter(item => item.userId !== userId) } }, { upsert: true });
  return { removed: found, opposite };
}

export default { getModerationState, saveTimeout, saveMute, removeModeration, removeModerationWithOpposite, addWarning, removeWarning, setWarnBanLimit, setWarnBanLimitWithPrevious, reconcileModerationState };
