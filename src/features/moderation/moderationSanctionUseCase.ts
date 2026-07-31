"use strict";

import type { ModerationRecord } from "./moderationRepository.js";

export type ModerationCommand =
  | "timeout"
  | "mute"
  | "remove-timeout"
  | "unmute"
  | "kick"
  | "ban"
  | "unban"
  | "warn"
  | "remove-warn"
  | "warn-ban-limit";

export type SanctionField = "moderationTimeouts" | "moderationMutes";

export type AutoBanResult = "not-reached" | "applied" | "failed";

export type ModerationOutcome =
  | { kind: "invalid-reason"; message: string }
  | { kind: "invalid-limit" }
  | { kind: "limit-changed"; previous: number; limit: number }
  | { kind: "user-required" }
  | { kind: "unban-unavailable" }
  | { kind: "unbanned" }
  | { kind: "target-unavailable" }
  | { kind: "invalid-duration" }
  | { kind: "bot-missing-permission"; permission: string }
  | { kind: "discord-action-unavailable"; action: "timeout" | "remove-timeout" | "kick" | "ban" }
  | { kind: "sanctioned"; command: "timeout" | "mute"; expiresAt: Date }
  | { kind: "conflicting-sanctions" }
  | { kind: "wrong-sanction-type"; has: "timeout" | "mute"; asked: "timeout" | "mute" }
  | { kind: "no-active-sanction"; asked: "timeout" | "mute" }
  | { kind: "sanction-removed" }
  | { kind: "member-removed"; command: "kick" | "ban" }
  | { kind: "warn-removed"; remaining: number }
  | { kind: "no-warnings" }
  | { kind: "warn-needs-evidence" }
  | { kind: "warn-channel-required" }
  | { kind: "warn-channel-missing-permissions"; missing: readonly string[] }
  | { kind: "warn-channel-without-id" }
  | { kind: "warn-channel-unavailable" }
  | { kind: "warn-orphaned" }
  | { kind: "warned"; count: number; autoBan: AutoBanResult }
  | { kind: "unknown-command" };

export type ModerationInput = {
  command: ModerationCommand;
  rawReason: string | undefined;
  hasAttachment: boolean;
  duration: number | null;
  limit: number | null;
  userId: string | null;
  username: string | undefined;
  moderatorId: string;
};

export type ModerationTarget = {
  canAct: boolean;
  canTimeout: boolean;
  canKick: boolean;
  canBan: boolean;
  timeout: (durationMs: number | null, reason?: string) => Promise<unknown>;
  kick: (reason?: string) => Promise<unknown>;
  ban: (reason: string | undefined) => Promise<unknown>;
};

export type WarningChannel =
  | { status: "ready"; send: (reason: string | null, count: number) => Promise<unknown> }
  | { status: "not-selected" }
  | { status: "missing-permissions"; missing: readonly string[] }
  | { status: "without-id" }
  | { status: "unavailable" };

export type ModerationDeps = {
  validateReason: (raw: string | undefined) => string | null;
  discordReason: (reason: string | null) => string | undefined;
  botHasPermission: (permission: string) => boolean;
  resolveTarget: () => Promise<ModerationTarget | null>;
  unbanUser: ((reason: string | undefined) => Promise<unknown>) | null;
  setWarnBanLimit: (limit: number) => Promise<number>;
  saveSanction: (command: "timeout" | "mute", record: ModerationRecord) => Promise<void>;
  findSanctionsForUser: () => Promise<{ timeout: ModerationRecord | null; mute: ModerationRecord | null }>;
  removeSanction: (field: SanctionField) => Promise<boolean>;
  removeWarning: () => Promise<{ removed: boolean; remaining: number }>;
  resolveWarningChannel: () => Promise<WarningChannel>;
  addWarning: (warningId: string) => Promise<{ count: number; limit: number }>;
  dropWarning: (warningId: string) => Promise<boolean>;
  newWarningId: () => string;
  reportOrphanedWarning: (error: unknown) => void;
  reportFailedAutoBan: (error: unknown) => void;
  now: () => number;
};

const SANCTION_FIELD: Record<"timeout" | "mute", SanctionField> = {
  timeout: "moderationTimeouts",
  mute: "moderationMutes"
};

function pairedSanction(command: "remove-timeout" | "unmute"): { asked: "timeout" | "mute"; opposite: "timeout" | "mute" } {
  return command === "remove-timeout" ? { asked: "timeout", opposite: "mute" } : { asked: "mute", opposite: "timeout" };
}

async function restoreTimeout(target: ModerationTarget, record: ModerationRecord | null, now: number): Promise<void> {
  if (!record?.expiresAt) return;
  const remaining = new Date(record.expiresAt).getTime() - now;
  if (remaining > 0) await target.timeout(remaining, record.reason);
}

async function applySanction(
  command: "timeout" | "mute",
  input: ModerationInput,
  deps: ModerationDeps,
  target: ModerationTarget,
  discordReason: string | undefined
): Promise<ModerationOutcome> {
  if (!input.duration) return { kind: "invalid-duration" };
  if (!deps.botHasPermission("ModerateMembers")) return { kind: "bot-missing-permission", permission: "ModerateMembers" };
  if (!target.canTimeout) return { kind: "discord-action-unavailable", action: "timeout" };

  const expiresAt = new Date(deps.now() + input.duration);
  const record: ModerationRecord = {
    userId: String(input.userId),
    username: input.username || String(input.userId),
    moderatorId: input.moderatorId,
    appliedAt: new Date(deps.now()),
    expiresAt,
    reason: discordReason
  };

  await target.timeout(input.duration, discordReason);
  try {
    await deps.saveSanction(command, record);
  } catch (error: unknown) {
    await target.timeout(null).catch(() => undefined);
    throw error;
  }
  return { kind: "sanctioned", command, expiresAt };
}

async function liftSanction(
  command: "remove-timeout" | "unmute",
  deps: ModerationDeps,
  target: ModerationTarget
): Promise<ModerationOutcome> {
  if (!deps.botHasPermission("ModerateMembers")) return { kind: "bot-missing-permission", permission: "ModerateMembers" };

  const { asked, opposite } = pairedSanction(command);
  const records = await deps.findSanctionsForUser();
  if (records.timeout && records.mute) return { kind: "conflicting-sanctions" };

  const active = asked === "timeout" ? records.timeout : records.mute;
  const other = asked === "timeout" ? records.mute : records.timeout;
  if (!active && other) return { kind: "wrong-sanction-type", has: opposite, asked };
  if (!active) return { kind: "no-active-sanction", asked };
  if (!target.canTimeout) return { kind: "discord-action-unavailable", action: "remove-timeout" };

  await target.timeout(null);
  try {
    const removed = await deps.removeSanction(SANCTION_FIELD[asked]);
    if (!removed) throw new Error("Sanctiunea nu a putut fi eliminata din persistenta.");
  } catch (error: unknown) {
    await restoreTimeout(target, active, deps.now()).catch(() => undefined);
    throw error;
  }
  return { kind: "sanction-removed" };
}

async function removeMember(
  command: "kick" | "ban",
  deps: ModerationDeps,
  target: ModerationTarget,
  discordReason: string | undefined
): Promise<ModerationOutcome> {
  const permission = command === "kick" ? "KickMembers" : "BanMembers";
  if (!deps.botHasPermission(permission)) return { kind: "bot-missing-permission", permission };
  if (command === "kick") {
    if (!target.canKick) return { kind: "discord-action-unavailable", action: "kick" };
    await target.kick(discordReason);
  } else {
    if (!target.canBan) return { kind: "discord-action-unavailable", action: "ban" };
    await target.ban(discordReason);
  }
  return { kind: "member-removed", command };
}

async function recordWarning(
  input: ModerationInput,
  deps: ModerationDeps,
  target: ModerationTarget,
  reason: string | null
): Promise<ModerationOutcome> {
  if (!reason && !input.hasAttachment) return { kind: "warn-needs-evidence" };

  const channel = await deps.resolveWarningChannel();
  if (channel.status === "not-selected") return { kind: "warn-channel-required" };
  if (channel.status === "missing-permissions") return { kind: "warn-channel-missing-permissions", missing: channel.missing };
  if (channel.status === "without-id") return { kind: "warn-channel-without-id" };
  if (channel.status === "unavailable") return { kind: "warn-channel-unavailable" };

  const warningId = deps.newWarningId();
  const result = await deps.addWarning(warningId);
  try {
    await channel.send(reason, result.count);
  } catch (error: unknown) {
    const rolledBack = await deps.dropWarning(warningId).then(() => true).catch(() => false);
    if (!rolledBack) {
      deps.reportOrphanedWarning(error);
      return { kind: "warn-orphaned" };
    }
    throw error;
  }

  let autoBan: AutoBanResult = "not-reached";
  if (result.limit > 0 && result.count >= result.limit && target.canBan && deps.botHasPermission("BanMembers")) {
    try {
      await target.ban(`Limita de warn-uri atinsa (${result.limit})`);
      autoBan = "applied";
    } catch (error: unknown) {
      deps.reportFailedAutoBan(error);
      autoBan = "failed";
    }
  }
  return { kind: "warned", count: result.count, autoBan };
}

export async function applyModerationCommand(input: ModerationInput, deps: ModerationDeps): Promise<ModerationOutcome> {
  let reason: string | null;
  try {
    reason = deps.validateReason(input.rawReason);
  } catch (error: unknown) {
    return { kind: "invalid-reason", message: error instanceof Error ? error.message : "Motivul nu este valid." };
  }
  const discordReason = deps.discordReason(reason);

  if (input.command === "warn-ban-limit") {
    if (!input.limit || input.limit < 1) return { kind: "invalid-limit" };
    const previous = await deps.setWarnBanLimit(input.limit);
    return { kind: "limit-changed", previous, limit: input.limit };
  }

  if (!input.userId) return { kind: "user-required" };

  if (input.command === "unban") {
    if (!deps.botHasPermission("BanMembers") || !deps.unbanUser) return { kind: "unban-unavailable" };
    await deps.unbanUser(discordReason);
    return { kind: "unbanned" };
  }

  const target = await deps.resolveTarget();
  if (!target || !target.canAct) return { kind: "target-unavailable" };

  switch (input.command) {
    case "timeout":
    case "mute":
      return applySanction(input.command, input, deps, target, discordReason);
    case "remove-timeout":
    case "unmute":
      return liftSanction(input.command, deps, target);
    case "kick":
    case "ban":
      return removeMember(input.command, deps, target, discordReason);
    case "remove-warn": {
      const result = await deps.removeWarning();
      return result.removed ? { kind: "warn-removed", remaining: result.remaining } : { kind: "no-warnings" };
    }
    case "warn":
      return recordWarning(input, deps, target, reason);
    default:
      return { kind: "unknown-command" };
  }
}
