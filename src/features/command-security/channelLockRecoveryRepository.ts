"use strict";

import type { LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";

export type ChannelLockCommand = "lock-channel" | "unlock-channel";

export interface ChannelLockRecoveryRecord {
  _id: string;
  guildId: string;
  channelId: string;
  command: ChannelLockCommand;
  previousState: LockedChannelPermissionState;
  divergedState: LockedChannelPermissionState;
  desiredState: LockedChannelPermissionState;
  desiredLocked: boolean;
  attempts?: number;
  lastError?: string | null;
  createdAt?: Date;
}

export interface ChannelLockRecoveryModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, boolean>
  ): Promise<{ modifiedCount?: number; upsertedCount?: number }>;
  find(filter: Record<string, unknown>): {
    sort(order: Record<string, number>): { limit(count: number): { lean(): Promise<ChannelLockRecoveryRecord[]> } };
  };
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
}

const RECOVERY_RETENTION_MS = 30 * 86_400_000;

export interface ChannelLockDivergence {
  guildId: string;
  channelId: string;
  command: ChannelLockCommand;
  previousState: LockedChannelPermissionState;
  divergedState: LockedChannelPermissionState;
  desiredState: LockedChannelPermissionState;
  desiredLocked: boolean;
}

export async function recordChannelLockDivergence(
  model: Pick<ChannelLockRecoveryModelLike, "updateOne">,
  divergence: ChannelLockDivergence,
  now: () => number = () => Date.now()
): Promise<boolean> {
  try {
    await model.updateOne(
      { _id: `${divergence.guildId}:${divergence.channelId}` },
      {
        $set: {
          guildId: divergence.guildId,
          channelId: divergence.channelId,
          command: divergence.command,
          previousState: divergence.previousState,
          divergedState: divergence.divergedState,
          desiredState: divergence.desiredState,
          desiredLocked: divergence.desiredLocked,
          expiresAt: new Date(now() + RECOVERY_RETENTION_MS)
        },
        $setOnInsert: { createdAt: new Date(now()), attempts: 0, lastError: null }
      },
      { upsert: true }
    );
    return true;
  } catch {
    return false;
  }
}

export async function listChannelLockRecoveries(
  model: Pick<ChannelLockRecoveryModelLike, "find">,
  limit = 25
): Promise<ChannelLockRecoveryRecord[]> {
  try {
    return await model.find({}).sort({ createdAt: 1 }).limit(limit).lean();
  } catch {
    return [];
  }
}

export async function countChannelLockRecoveries(
  model: Pick<ChannelLockRecoveryModelLike, "countDocuments">,
  guildId: string
): Promise<number> {
  try {
    return await model.countDocuments({ guildId });
  } catch {
    return -1;
  }
}

export async function closeChannelLockRecovery(
  model: Pick<ChannelLockRecoveryModelLike, "deleteOne">,
  guildId: string,
  channelId: string
): Promise<boolean> {
  try {
    const result = await model.deleteOne({ _id: `${guildId}:${channelId}` });
    return (result.deletedCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function recordChannelLockRecoveryAttempt(
  model: Pick<ChannelLockRecoveryModelLike, "updateOne">,
  guildId: string,
  channelId: string,
  reason: string
): Promise<void> {
  try {
    await model.updateOne({ _id: `${guildId}:${channelId}` }, { $inc: { attempts: 1 }, $set: { lastError: reason } });
  } catch {
    return;
  }
}

export default {
  recordChannelLockDivergence,
  listChannelLockRecoveries,
  countChannelLockRecoveries,
  closeChannelLockRecovery,
  recordChannelLockRecoveryAttempt
};
