"use strict";

export const MASS_MODERATION_WINDOW_MS = 5 * 60 * 1000;
export const MASS_MODERATION_DISTINCT_LIMIT = 3;

export const MASS_MODERATION_ACTIONS = ["ban", "kick"] as const;

export type MassModerationAction = (typeof MASS_MODERATION_ACTIONS)[number];

export interface MassModerationEvent {
  auditId: string;
  targetId: string;
  action: MassModerationAction;
  at: Date;
}

export interface MassModerationWindow {
  _id: string;
  guildId: string;
  actorId: string;
  events: MassModerationEvent[];
  sanctionedAt: Date | null;
}

export function withinWindow(events: readonly MassModerationEvent[], now: Date): MassModerationEvent[] {
  const cutoff = now.getTime() - MASS_MODERATION_WINDOW_MS;
  return events.filter(event => event.at.getTime() > cutoff);
}

export function distinctTargets(events: readonly MassModerationEvent[]): string[] {
  return [...new Set(events.map(event => event.targetId))].sort();
}

export function breachesThreshold(events: readonly MassModerationEvent[]): boolean {
  return distinctTargets(events).length >= MASS_MODERATION_DISTINCT_LIMIT;
}

export interface ApprovalSlice {
  action: MassModerationAction;
  targets: string[];
}

export function approvalSlices(events: readonly MassModerationEvent[]): ApprovalSlice[] {
  const byAction = new Map<MassModerationAction, Set<string>>();
  for (const event of events) {
    const targets = byAction.get(event.action) ?? new Set<string>();
    targets.add(event.targetId);
    byAction.set(event.action, targets);
  }
  return [...byAction.entries()]
    .map(([action, targets]) => ({ action, targets: [...targets].sort() }))
    .sort((left, right) => left.action.localeCompare(right.action));
}

export function describeSlices(slices: readonly ApprovalSlice[]): string {
  return slices.map(slice => `${slice.action} x${slice.targets.length}`).join(", ");
}

export function describeWindow(events: readonly MassModerationEvent[]): string {
  const targets = distinctTargets(events);
  const bans = events.filter(event => event.action === "ban").length;
  const kicks = events.length - bans;
  const parts: string[] = [];
  if (bans > 0) parts.push(`${bans} ban-uri`);
  if (kicks > 0) parts.push(`${kicks} kick-uri`);
  return `${parts.join(" si ")} asupra a ${targets.length} persoane distincte in ultimele 5 minute`;
}
