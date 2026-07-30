"use strict";

export const PURGE_MIN = 1;
export const PURGE_MAX = 100;

export type PurgeOutcome =
  | { kind: "invalid-amount"; min: number; max: number }
  | { kind: "channel-not-purgeable" }
  | { kind: "missing-permissions"; missing: readonly string[] }
  | { kind: "purged"; requested: number; deleted: number; skipped: number }
  | { kind: "purge-failed"; error: unknown };

export type PurgeInput = {
  amount: number;
};

export type PurgeDeps = {
  canBulkDelete: () => boolean;
  missingPermissions: () => readonly string[];
  bulkDelete: (amount: number) => Promise<number>;
};

export async function purgeMessages(input: PurgeInput, deps: PurgeDeps): Promise<PurgeOutcome> {
  if (input.amount < PURGE_MIN || input.amount > PURGE_MAX) {
    return { kind: "invalid-amount", min: PURGE_MIN, max: PURGE_MAX };
  }
  if (!deps.canBulkDelete()) return { kind: "channel-not-purgeable" };

  const missing = deps.missingPermissions();
  if (missing.length > 0) return { kind: "missing-permissions", missing };

  try {
    const deleted = await deps.bulkDelete(input.amount);
    return { kind: "purged", requested: input.amount, deleted, skipped: Math.max(0, input.amount - deleted) };
  } catch (error: unknown) {
    return { kind: "purge-failed", error };
  }
}
