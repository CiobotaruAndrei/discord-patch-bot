"use strict";

export type SourceHealthState = "healthy" | "degraded" | "cooling-down" | "schema-drift";

export interface SourceHealthDoc {
  key: string;
  fails: number;
  cooldownUntil: Date | string | null;
  schemaDriftFails: number;
}

export function classifySourceHealth(doc: SourceHealthDoc, now: Date = new Date()): SourceHealthState {
  const cooldown = doc.cooldownUntil ? new Date(doc.cooldownUntil) : null;
  if (cooldown && Number.isFinite(cooldown.getTime()) && now < cooldown) return "cooling-down";
  if ((doc.schemaDriftFails ?? 0) > 0) return "schema-drift";
  if ((doc.fails ?? 0) > 0) return "degraded";
  return "healthy";
}

export interface SourceHealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  coolingDown: number;
  schemaDrift: number;
  unhealthy: Array<{ key: string; state: SourceHealthState }>;
}

export function summarizeSourceHealth(docs: SourceHealthDoc[], now: Date = new Date()): SourceHealthSummary {
  const summary: SourceHealthSummary = {
    total: docs.length, healthy: 0, degraded: 0, coolingDown: 0, schemaDrift: 0, unhealthy: []
  };
  for (const doc of docs) {
    const state = classifySourceHealth(doc, now);
    if (state === "healthy") {
      summary.healthy++;
      continue;
    }
    if (state === "degraded") summary.degraded++;
    else if (state === "cooling-down") summary.coolingDown++;
    else summary.schemaDrift++;
    summary.unhealthy.push({ key: doc.key, state });
  }
  summary.unhealthy.sort((left, right) => left.key.localeCompare(right.key));
  return summary;
}
