"use strict";

export type FutureReleaseState = {
  releaseTs: number;
  notified: number[];
  preorderNotified?: boolean;
  released?: boolean;
};

export type FutureReleaseEvent = "30d" | "7d" | "1d" | "preorder" | "released";

export function computeFutureReleaseUpdate(state: FutureReleaseState, now: number, preorderAvailable = false): { state: FutureReleaseState; events: FutureReleaseEvent[] } {
  const next: FutureReleaseState = { ...state, notified: [...new Set(state.notified ?? [])] };
  const events: FutureReleaseEvent[] = [];
  if (!Number.isFinite(state.releaseTs) || state.releaseTs <= now) {
    if (!next.released) events.push("released");
    next.released = true;
    return { state: next, events };
  }
  const remaining = state.releaseTs - now;
  for (const threshold of [30, 7, 1]) {
    if (remaining <= threshold * 86_400_000 && !next.notified.includes(threshold)) {
      next.notified.push(threshold);
      events.push(`${threshold}d` as FutureReleaseEvent);
    }
  }
  if (preorderAvailable && !next.preorderNotified) {
    next.preorderNotified = true;
    events.push("preorder");
  }
  return { state: next, events };
}

export default { computeFutureReleaseUpdate };
