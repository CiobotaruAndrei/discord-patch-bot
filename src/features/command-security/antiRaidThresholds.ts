"use strict";

export interface AntiRaidThresholds {
  identicalMessages: number;
  identicalWindowMs: number;
  mentionCount: number;
  mentionWindowMs: number;
  inviteMessages: number;
  inviteWindowMs: number;
  linkMessages: number;
  linkWindowMs: number;
  coordinatedActors: number;
  coordinatedWindowMs: number;
  structureChanges: number;
  structureWindowMs: number;
  safetyPeriodMs: number;
  muteDurationMs: number;
  timeoutDurationMs: number;
  maxLockdownMs: number;
}

export const DEFAULT_ANTI_RAID_THRESHOLDS: AntiRaidThresholds = {
  identicalMessages: 3,
  identicalWindowMs: 8_000,
  mentionCount: 4,
  mentionWindowMs: 10_000,
  inviteMessages: 3,
  inviteWindowMs: 20_000,
  linkMessages: 4,
  linkWindowMs: 12_000,
  coordinatedActors: 2,
  coordinatedWindowMs: 15_000,
  structureChanges: 3,
  structureWindowMs: 20_000,
  safetyPeriodMs: 30 * 60_000,
  muteDurationMs: 24 * 3_600_000,
  timeoutDurationMs: 24 * 3_600_000,
  maxLockdownMs: 45 * 60_000
};

const COUNT_BOUNDS: Record<string, { min: number; max: number }> = {
  identicalMessages: { min: 2, max: 50 },
  mentionCount: { min: 2, max: 100 },
  inviteMessages: { min: 2, max: 50 },
  linkMessages: { min: 2, max: 50 },
  coordinatedActors: { min: 2, max: 50 },
  structureChanges: { min: 2, max: 50 }
};

const DURATION_BOUNDS: Record<string, { min: number; max: number }> = {
  identicalWindowMs: { min: 1_000, max: 300_000 },
  mentionWindowMs: { min: 1_000, max: 300_000 },
  inviteWindowMs: { min: 1_000, max: 300_000 },
  linkWindowMs: { min: 1_000, max: 300_000 },
  coordinatedWindowMs: { min: 1_000, max: 300_000 },
  structureWindowMs: { min: 1_000, max: 300_000 },
  safetyPeriodMs: { min: 60_000, max: 24 * 3_600_000 },
  muteDurationMs: { min: 60_000, max: 30 * 24 * 3_600_000 },
  timeoutDurationMs: { min: 60_000, max: 28 * 24 * 3_600_000 },
  maxLockdownMs: { min: 60_000, max: 24 * 3_600_000 }
};

export const ANTI_RAID_THRESHOLD_KEYS = [
  ...Object.keys(COUNT_BOUNDS),
  ...Object.keys(DURATION_BOUNDS)
] as ReadonlyArray<keyof AntiRaidThresholds>;

export function parseDuration(raw: string): number | null {
  const match = /^\s*(\d{1,6})\s*(s|m|h|d)\s*$/i.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit === "s") return amount * 1_000;
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  return amount * 86_400_000;
}

export function formatDuration(ms: number): string {
  if (ms >= 2 * 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1_000)}s`;
}

export type ThresholdRejection = { key: string; reason: string };

export function applyThresholdOverrides(
  base: AntiRaidThresholds,
  overrides: Readonly<Record<string, unknown>>
): { thresholds: AntiRaidThresholds; rejected: ThresholdRejection[] } {
  const thresholds: AntiRaidThresholds = { ...base };
  const rejected: ThresholdRejection[] = [];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;

    const countBound = COUNT_BOUNDS[key];
    if (countBound) {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(parsed) || parsed < countBound.min || parsed > countBound.max) {
        rejected.push({ key, reason: `trebuie sa fie un numar intreg intre ${countBound.min} si ${countBound.max}` });
        continue;
      }
      Object.assign(thresholds, { [key]: parsed });
      continue;
    }

    const durationBound = DURATION_BOUNDS[key];
    if (!durationBound) {
      rejected.push({ key, reason: "nu este un prag anti-raid cunoscut" });
      continue;
    }
    const parsed = typeof value === "number" ? value : parseDuration(String(value));
    if (parsed === null || !Number.isFinite(parsed) || parsed < durationBound.min || parsed > durationBound.max) {
      rejected.push({
        key,
        reason: `trebuie sa fie o durata intre ${formatDuration(durationBound.min)} si ${formatDuration(durationBound.max)}`
      });
      continue;
    }
    Object.assign(thresholds, { [key]: parsed });
  }

  return { thresholds, rejected };
}

export function readThresholds(stored: Readonly<Record<string, unknown>> | null | undefined): AntiRaidThresholds {
  if (!stored) return { ...DEFAULT_ANTI_RAID_THRESHOLDS };
  return applyThresholdOverrides(DEFAULT_ANTI_RAID_THRESHOLDS, stored).thresholds;
}

export function describeThresholds(thresholds: AntiRaidThresholds): string[] {
  return [
    `Mesaje identice sau aproape identice: ${thresholds.identicalMessages} in maximum ${formatDuration(thresholds.identicalWindowMs)}`,
    `Spam cu taguri: minimum ${thresholds.mentionCount} mentiuni in maximum ${formatDuration(thresholds.mentionWindowMs)} (intra @everyone, @here, roluri si utilizatori)`,
    `Spam cu servere, invitatii sau reclame: minimum ${thresholds.inviteMessages} mesaje in maximum ${formatDuration(thresholds.inviteWindowMs)}`,
    `Spam cu linkuri sau atasamente: minimum ${thresholds.linkMessages} mesaje in maximum ${formatDuration(thresholds.linkWindowMs)}`,
    `Spam coordonat: minimum ${thresholds.coordinatedActors} persoane sau boti in maximum ${formatDuration(thresholds.coordinatedWindowMs)}`,
    `Canale sau roluri create ori sterse fara autorizatie: minimum ${thresholds.structureChanges} in maximum ${formatDuration(thresholds.structureWindowMs)}`,
    `Perioada de siguranta: ${formatDuration(thresholds.safetyPeriodMs)} fara activitate noua de raid`,
    `Durata mute-ului: ${formatDuration(thresholds.muteDurationMs)}`,
    `Durata timeout-ului: ${formatDuration(thresholds.timeoutDurationMs)}`,
    `Durata maxima a lockdown-ului inainte de solicitarea interventiei ownerului: ${formatDuration(thresholds.maxLockdownMs)}`
  ];
}
