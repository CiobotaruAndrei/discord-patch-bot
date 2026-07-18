"use strict";

export type BotObservationEvent = {
  id: string;
  guildId: string;
  subjectId?: string;
  kind: "new-account" | "threat" | "bot-add" | "moderation";
  at: number;
  details?: string;
};

export type BotObservationSnapshot = {
  guildId: string;
  windowStart: number;
  total: number;
  byKind: Record<BotObservationEvent["kind"], number>;
  burst: boolean;
};

export function createBotObservationAggregator(options: { windowMs?: number; burstThreshold?: number } = {}) {
  const windowMs = options.windowMs ?? 15 * 60_000;
  const burstThreshold = options.burstThreshold ?? 5;
  const events = new Map<string, BotObservationEvent>();

  function prune(now: number): void {
    for (const [id, event] of events) if (event.at < now - windowMs) events.delete(id);
  }

  function record(event: BotObservationEvent): BotObservationSnapshot {
    prune(event.at);
    if (!events.has(event.id)) events.set(event.id, { ...event });
    return snapshot(event.guildId, event.at);
  }

  function snapshot(guildId: string, now = Date.now()): BotObservationSnapshot {
    prune(now);
    const byKind: BotObservationSnapshot["byKind"] = { "new-account": 0, threat: 0, "bot-add": 0, moderation: 0 };
    let total = 0;
    let windowStart = now;
    for (const event of events.values()) {
      if (event.guildId !== guildId) continue;
      total++;
      byKind[event.kind]++;
      windowStart = Math.min(windowStart, event.at);
    }
    return { guildId, windowStart, total, byKind, burst: total >= burstThreshold };
  }

  function clear(): void { events.clear(); }
  return Object.freeze({ record, snapshot, clear });
}

export type BotObservationAggregator = ReturnType<typeof createBotObservationAggregator>;
