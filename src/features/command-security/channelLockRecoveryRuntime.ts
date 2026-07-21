"use strict";

import type { LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";
import {
  closeChannelLockRecovery,
  listChannelLockRecoveries,
  recordChannelLockRecoveryAttempt,
  type ChannelLockRecoveryModelLike,
  type ChannelLockRecoveryRecord
} from "./channelLockRecoveryRepository.js";

export type RecoveryOutcome = "converged" | "superseded" | "unavailable" | "discord-failed" | "persist-failed";

export interface LockOverwriteEntry {
  allow?: { has(flag: string): boolean };
  deny?: { has(flag: string): boolean };
}

export interface LockOverwriteHolder {
  permissionOverwrites?: { cache?: { get(id: string): LockOverwriteEntry | undefined } };
}

export function readLockedChannelPermissionState(channel: LockOverwriteHolder, everyoneId: string): LockedChannelPermissionState {
  const overwrite = channel.permissionOverwrites?.cache?.get(everyoneId);
  if (overwrite?.allow?.has("SendMessages")) return "allow";
  if (overwrite?.deny?.has("SendMessages")) return "deny";
  return "inherit";
}

export interface RecoveryChannel extends LockOverwriteHolder {
  id?: string;
  guild?: { roles?: { everyone?: { id: string } | null } | null } | null;
  permissionOverwrites?: {
    cache?: { get(id: string): LockOverwriteEntry | undefined };
    edit(target: object, permissions: { SendMessages: boolean | null }): Promise<unknown>;
  };
}

export interface ChannelLockRecoveryDeps {
  RecoveryModel: ChannelLockRecoveryModelLike;
  fetchChannel(guildId: string, channelId: string): Promise<RecoveryChannel | null>;
  readState?(channel: RecoveryChannel, everyoneId: string): LockedChannelPermissionState;
  persistState(guildId: string, channelId: string, previous: LockedChannelPermissionState, locked: boolean): Promise<unknown>;
  logger?(level: string, context: string, message: string, meta?: unknown): void;
  batchSize?: number;
}

function permissionValue(state: LockedChannelPermissionState): boolean | null {
  if (state === "allow") return true;
  if (state === "deny") return false;
  return null;
}

export function createChannelLockRecoveryRuntime(deps: ChannelLockRecoveryDeps) {
  const readState = deps.readState ?? readLockedChannelPermissionState;
  async function recoverOne(record: ChannelLockRecoveryRecord): Promise<RecoveryOutcome> {
    const channel = await deps.fetchChannel(record.guildId, record.channelId).catch(() => null);
    const everyone = channel?.guild?.roles?.everyone ?? null;
    const edit = channel?.permissionOverwrites?.edit;
    if (!everyone || !channel || !edit) {
      await recordChannelLockRecoveryAttempt(deps.RecoveryModel, record.guildId, record.channelId, "canal sau rol @everyone indisponibil");
      return "unavailable";
    }

    const current = readState(channel, everyone.id);
    if (current === record.desiredState) {
      return await persistAndClose(record) ? "converged" : "persist-failed";
    }
    if (current !== record.divergedState) {
      deps.logger?.("WARN", "LOCK_CHANNEL_RECOVERY", "Permisiunea canalului a fost schimbata legitim intre timp; recovery-ul NU suprascrie schimbarea si inchide inregistrarea", {
        guildId: record.guildId,
        channelId: record.channelId,
        expected: record.divergedState,
        found: current
      });
      await closeChannelLockRecovery(deps.RecoveryModel, record.guildId, record.channelId);
      return "superseded";
    }

    try {
      await edit.call(channel.permissionOverwrites, everyone, { SendMessages: permissionValue(record.desiredState) });
    } catch (error) {
      await recordChannelLockRecoveryAttempt(deps.RecoveryModel, record.guildId, record.channelId, error instanceof Error ? error.message : "eroare Discord");
      return "discord-failed";
    }

    const verified = readState(channel, everyone.id);
    if (verified !== record.desiredState) {
      await recordChannelLockRecoveryAttempt(deps.RecoveryModel, record.guildId, record.channelId, `verificarea post-restaurare a intors ${verified}`);
      return "discord-failed";
    }

    return await persistAndClose(record) ? "converged" : "persist-failed";
  }

  async function persistAndClose(record: ChannelLockRecoveryRecord): Promise<boolean> {
    try {
      await deps.persistState(record.guildId, record.channelId, record.previousState, record.desiredLocked);
    } catch (error) {
      await recordChannelLockRecoveryAttempt(deps.RecoveryModel, record.guildId, record.channelId, error instanceof Error ? error.message : "eroare Mongo");
      return false;
    }
    await closeChannelLockRecovery(deps.RecoveryModel, record.guildId, record.channelId);
    return true;
  }

  async function runRecoveryCycle(): Promise<Record<RecoveryOutcome, number>> {
    const totals: Record<RecoveryOutcome, number> = {
      converged: 0,
      superseded: 0,
      unavailable: 0,
      "discord-failed": 0,
      "persist-failed": 0
    };
    const records = await listChannelLockRecoveries(deps.RecoveryModel, deps.batchSize ?? 25);
    for (const record of records) {
      const outcome = await recoverOne(record);
      totals[outcome]++;
    }
    if (totals.converged > 0) {
      deps.logger?.("INFO", "LOCK_CHANNEL_RECOVERY", "Divergente lock/unlock restaurate automat si inchise", { converged: totals.converged });
    }
    return totals;
  }

  return { recoverOne, runRecoveryCycle };
}

export default { createChannelLockRecoveryRuntime, readLockedChannelPermissionState };
