"use strict";

import type { RaidSnapshot } from "./raidSnapshotTypes.js";

export const BASELINE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const BASELINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function baselineId(guildId: string): string {
  return `baseline:${guildId}`;
}

export interface BaselineRecord {
  guildId: string;
  snapshot: RaidSnapshot;
  frozenAt: Date | null;
}

export type BaselineChoice =
  | { kind: "frozen-baseline"; snapshot: RaidSnapshot; ageMs: number }
  | { kind: "live-capture"; reason: string };

export function chooseIncidentSnapshot(
  baseline: BaselineRecord | null,
  incidentStartedAt: Date,
  now: number
): BaselineChoice {
  if (!baseline) return { kind: "live-capture", reason: "nu exista niciun baseline salvat" };
  if (!baseline.frozenAt) {
    return { kind: "live-capture", reason: "baseline-ul nu a fost inghetat la primul semnal" };
  }

  const capturedAt = baseline.snapshot.capturedAt.getTime();
  if (capturedAt > incidentStartedAt.getTime()) {
    return { kind: "live-capture", reason: "baseline-ul e mai nou decat incidentul, deci deja contaminat" };
  }

  const ageMs = now - capturedAt;
  if (ageMs > BASELINE_MAX_AGE_MS) {
    return { kind: "live-capture", reason: `baseline-ul are ${Math.round(ageMs / 86_400_000)} zile, prea vechi ca referinta` };
  }

  return { kind: "frozen-baseline", snapshot: baseline.snapshot, ageMs };
}

export function needsRefresh(baseline: BaselineRecord | null, now: number): boolean {
  if (!baseline) return true;
  if (baseline.frozenAt) return false;
  return now - baseline.snapshot.capturedAt.getTime() >= BASELINE_REFRESH_MS;
}

export function describeBaselineChoice(choice: BaselineChoice): string {
  if (choice.kind === "frozen-baseline") {
    const minutes = Math.max(1, Math.round(choice.ageMs / 60_000));
    return `Recovery foloseste baseline-ul inghetat la primul semnal suspect (vechime ${minutes} min), `
      + "deci resursele distruse inainte de confirmare pot fi recreate.";
  }
  return `Recovery foloseste starea curenta a serverului ca referinta (${choice.reason}); `
    + "resursele distruse inaintea confirmarii NU pot fi recreate din ea.";
}
