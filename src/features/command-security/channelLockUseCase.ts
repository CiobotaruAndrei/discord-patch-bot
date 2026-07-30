"use strict";

import type { LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";

export type ChannelLockCommand = "lock-channel" | "unlock-channel";

export type ChannelLockOutcome =
  | { kind: "channel-not-editable" }
  | { kind: "permissions-unreadable" }
  | { kind: "missing-permissions"; missing: readonly string[] }
  | { kind: "channel-cannot-receive-notice" }
  | { kind: "already-locked" }
  | { kind: "not-locked" }
  | { kind: "invalid-reason"; message: string }
  | { kind: "reason-required" }
  | { kind: "previous-state-unknown" }
  | { kind: "diverged"; command: ChannelLockCommand; previous: LockedChannelPermissionState; recoveryScheduled: boolean }
  | { kind: "notice-failed"; persistenceReverted: boolean; discordReverted: boolean }
  | { kind: "applied"; command: ChannelLockCommand; reason: string | null }
  | { kind: "failed"; error: unknown };

export type ChannelLockInput = {
  command: ChannelLockCommand;
  rawReason: string | null;
  hasAttachment: boolean;
  isLocked: boolean;
};

export type ChannelLockDeps = {
  canEditOverwrites: () => boolean;
  readBotPermissions: () => { missing: readonly string[] } | null;
  canSendNotice: () => boolean;
  validateReason: (raw: string | null) => string | null;
  readPreviousState: () => LockedChannelPermissionState | undefined;
  applyOverwrite: (locked: boolean) => Promise<void>;
  persistState: (previous: LockedChannelPermissionState, locked: boolean) => Promise<void>;
  revertOverwrite: (locked: boolean) => Promise<boolean>;
  recordDivergence: (previous: LockedChannelPermissionState) => Promise<boolean>;
  sendNotice: (reason: string | null) => Promise<void>;
  revertPersistence: (previous: LockedChannelPermissionState) => Promise<boolean>;
};

export async function applyChannelLock(input: ChannelLockInput, deps: ChannelLockDeps): Promise<ChannelLockOutcome> {
  const locking = input.command === "lock-channel";

  if (!deps.canEditOverwrites()) return { kind: "channel-not-editable" };

  const permissions = deps.readBotPermissions();
  if (!permissions) return { kind: "permissions-unreadable" };
  if (permissions.missing.length > 0) return { kind: "missing-permissions", missing: permissions.missing };

  if (locking && !deps.canSendNotice()) return { kind: "channel-cannot-receive-notice" };

  if (!locking && !input.isLocked) return { kind: "not-locked" };
  if (locking && input.isLocked) return { kind: "already-locked" };

  let reason: string | null;
  try {
    reason = locking ? deps.validateReason(input.rawReason) : null;
  } catch (error: unknown) {
    return { kind: "invalid-reason", message: error instanceof Error ? error.message : "Eroare: motivul nu este valid." };
  }
  if (locking && !reason && !input.hasAttachment) return { kind: "reason-required" };

  const previous = deps.readPreviousState();
  if (!previous) return { kind: "previous-state-unknown" };

  try {
    await deps.applyOverwrite(locking);
    try {
      await deps.persistState(previous, locking);
    } catch (error: unknown) {
      const discordReverted = await deps.revertOverwrite(!locking);
      if (discordReverted) throw error;
      const recoveryScheduled = await deps.recordDivergence(previous);
      return { kind: "diverged", command: input.command, previous, recoveryScheduled };
    }

    if (locking) {
      try {
        await deps.sendNotice(reason);
      } catch (error: unknown) {
        const persistenceReverted = await deps.revertPersistence(previous);
        const discordReverted = await deps.revertOverwrite(false);
        if (persistenceReverted && discordReverted) throw error;
        return { kind: "notice-failed", persistenceReverted, discordReverted };
      }
    }

    return { kind: "applied", command: input.command, reason };
  } catch (error: unknown) {
    return { kind: "failed", error };
  }
}
