"use strict";

import type { PendingUpdate, UpdateFetchResult } from "./pendingUpdatesQueue";

export type RotateAfter = <T>(arr: T[], lastSeen: T | null) => T[];

export function planRebaselineEntries(
  resultByGameKey: Map<string, UpdateFetchResult>
): Array<{ gameKey: string; updateId: string }> {
  const entries: Array<{ gameKey: string; updateId: string }> = [];
  for (const [gameKey, result] of resultByGameKey) {
    const updateId = result?.latest?.id;
    if (updateId) entries.push({ gameKey: String(gameKey), updateId: String(updateId) });
  }
  return entries;
}

export function takeNextPending(
  pendingByGame: Map<string, PendingUpdate[]>,
  lastProcessedGameKey: string | null,
  rotateAfter: RotateAfter
): { gameKey: string; item: PendingUpdate } | null {
  const keys = Array.from(pendingByGame.keys()).filter(key => (pendingByGame.get(key) || []).length);
  if (!keys.length) return null;
  const gameKey = rotateAfter(keys, lastProcessedGameKey)[0] as string;
  const queue = pendingByGame.get(gameKey) || [];
  const next = queue.shift();
  if (queue.length) pendingByGame.set(gameKey, queue);
  else pendingByGame.delete(gameKey);
  if (!next) return null;
  return { gameKey, item: next };
}

export function planPendingFailure(
  item: PendingUpdate,
  maxAttempts: number
): { action: "requeue" | "dead-letter"; attempts: number } {
  const attempts = (item.attempts || 0) + 1;
  item.attempts = attempts;
  return { action: attempts < maxAttempts ? "requeue" : "dead-letter", attempts };
}

export function requeueFront(
  pendingByGame: Map<string, PendingUpdate[]>,
  gameKey: string,
  item: PendingUpdate
): void {
  const queue = pendingByGame.get(gameKey) || [];
  queue.unshift(item);
  pendingByGame.set(gameKey, queue);
}
