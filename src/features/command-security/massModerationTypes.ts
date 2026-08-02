"use strict";

export const MASS_MODERATION_WINDOW_MS = 5 * 60 * 1000;
export const MASS_MODERATION_DISTINCT_LIMIT = 3;

export type MassModerationAction = "kick" | "ban";

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

export function dominantAction(events: readonly MassModerationEvent[]): MassModerationAction {
  const bans = events.filter(event => event.action === "ban").length;
  return bans * 2 >= events.length ? "ban" : "kick";
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
