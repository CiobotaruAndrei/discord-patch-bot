"use strict";

import { applyThresholdOverrides, DEFAULT_ANTI_RAID_THRESHOLDS } from "./antiRaidThresholds.js";

import type { AntiRaidThresholds, ThresholdRejection } from "./antiRaidThresholds.js";

export const THRESHOLD_OPTION_FIELDS: Readonly<Record<string, keyof AntiRaidThresholds>> = {
  "identical-messages": "identicalMessages",
  "identical-window": "identicalWindowMs",
  "mention-count": "mentionCount",
  "mention-window": "mentionWindowMs",
  "invite-messages": "inviteMessages",
  "invite-window": "inviteWindowMs",
  "link-messages": "linkMessages",
  "link-window": "linkWindowMs",
  "coordinated-actors": "coordinatedActors",
  "coordinated-window": "coordinatedWindowMs",
  "structure-changes": "structureChanges",
  "structure-window": "structureWindowMs",
  "safety-period": "safetyPeriodMs",
  "mute-duration": "muteDurationMs",
  "timeout-duration": "timeoutDurationMs",
  "max-lockdown": "maxLockdownMs"
};

export const THRESHOLD_OPTION_NAMES: readonly string[] = Object.keys(THRESHOLD_OPTION_FIELDS);

export function isDurationOption(optionName: string): boolean {
  const field = THRESHOLD_OPTION_FIELDS[optionName];
  return typeof field === "string" && field.endsWith("Ms");
}

export interface ThresholdUpdate {
  thresholds: AntiRaidThresholds;
  applied: string[];
  rejected: ThresholdRejection[];
  provided: number;
}

export function currentThresholds(stored: Record<string, unknown> | null | undefined): AntiRaidThresholds {
  if (!stored) return { ...DEFAULT_ANTI_RAID_THRESHOLDS };
  const merged = applyThresholdOverrides(DEFAULT_ANTI_RAID_THRESHOLDS, stored);
  return merged.thresholds;
}

export function planThresholdUpdate(
  stored: Record<string, unknown> | null | undefined,
  options: Readonly<Record<string, unknown>>
): ThresholdUpdate {
  const base = currentThresholds(stored);
  const overrides: Record<string, unknown> = {};
  let provided = 0;

  for (const [optionName, field] of Object.entries(THRESHOLD_OPTION_FIELDS)) {
    const value = options[optionName];
    if (value === undefined || value === null || value === "") continue;
    provided += 1;
    overrides[field] = value;
  }

  const result = applyThresholdOverrides(base, overrides);
  const rejectedFields = new Set(result.rejected.map(rejection => rejection.key));
  const applied = Object.entries(THRESHOLD_OPTION_FIELDS)
    .filter(([optionName, field]) => overrides[field] !== undefined && !rejectedFields.has(field) && optionName.length > 0)
    .map(([optionName]) => optionName);

  const rejected = result.rejected.map(rejection => ({
    key: Object.entries(THRESHOLD_OPTION_FIELDS).find(([, field]) => field === rejection.key)?.[0] ?? rejection.key,
    reason: rejection.reason
  }));

  return { thresholds: result.thresholds, applied, rejected, provided };
}
