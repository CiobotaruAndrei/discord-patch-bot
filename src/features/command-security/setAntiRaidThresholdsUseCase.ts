"use strict";

import { planThresholdUpdate } from "./antiRaidThresholdOptions.js";

import type { AntiRaidThresholds, ThresholdRejection } from "./antiRaidThresholds.js";

export type SetThresholdsOutcome =
  | { kind: "nothing-provided" }
  | { kind: "read-failed" }
  | { kind: "save-failed"; error: unknown }
  | { kind: "applied"; applied: readonly string[]; rejected: readonly ThresholdRejection[] };

export interface SetThresholdsDeps {
  readStored: () => Record<string, unknown> | null | undefined;
  persist: (thresholds: AntiRaidThresholds) => Promise<void>;
}

export async function setAntiRaidThresholds(
  options: Readonly<Record<string, unknown>>,
  deps: SetThresholdsDeps
): Promise<SetThresholdsOutcome> {
  const plan = planThresholdUpdate(deps.readStored(), options);
  if (plan.provided === 0) return { kind: "nothing-provided" };

  if (plan.applied.length > 0) {
    try {
      await deps.persist(plan.thresholds);
    } catch (error: unknown) {
      return { kind: "save-failed", error };
    }
  }

  return { kind: "applied", applied: plan.applied, rejected: plan.rejected };
}
