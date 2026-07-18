"use strict";

import type { CircuitBreakerDoc } from "./updates/updatesContracts.js";

export type SourceFailureKind = "transient" | "schema-drift";

export function isCoolingDown(doc: Pick<CircuitBreakerDoc, "cooldownUntil">, now: Date = new Date()): boolean {
  return Boolean(doc.cooldownUntil && now < new Date(doc.cooldownUntil));
}

export function shouldOpenSourceCircuit(
  doc: Pick<CircuitBreakerDoc, "fails" | "schemaDriftFails" | "cooldownUntil">,
  kind: SourceFailureKind,
  thresholds: { failures: number; schemaDrift: number },
  now: Date = new Date()
): boolean {
  if (isCoolingDown(doc, now)) return false;
  const count = kind === "schema-drift" ? (doc.schemaDriftFails ?? 0) : (doc.fails ?? 0);
  const threshold = kind === "schema-drift" ? thresholds.schemaDrift : thresholds.failures;
  return count >= threshold;
}

export function nextCooldown(now: Date, baseMs: number, jitterMs: number, random: () => number = Math.random): Date {
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * Math.max(0, jitterMs));
  return new Date(now.getTime() + Math.max(0, baseMs) + jitter);
}
