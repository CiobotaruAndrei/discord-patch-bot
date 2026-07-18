"use strict";

import type { NotificationHistoryEntry, NotificationHistoryRecord, NotificationKind } from "./historyRepository.js";
import type { PendingDiscount, PendingUpdate } from "../../types.js";

export interface NotificationHistoryPort {
  recordSent(guildId: string, entries: NotificationHistoryEntry[]): Promise<void>;
  getRecent(guildId: string, kind: NotificationKind | "all", limit: number): Promise<NotificationHistoryRecord[]>;
}

export interface SeenNotificationPort {
  claimSeenUpdate(guildId: string, channelId: string, gameKey: string, updateId: string): Promise<{ matchedCount?: number; modifiedCount?: number; upsertedCount?: number }>;
  rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string): Promise<{ matchedCount?: number; modifiedCount?: number; upsertedCount?: number }>;
  claimSeenDiscount(guildId: string, channelId: string, hash: string): Promise<{ matchedCount?: number; modifiedCount?: number; upsertedCount?: number }>;
  rollbackSeenDiscount(guildId: string, hash: string): Promise<{ matchedCount?: number; modifiedCount?: number; upsertedCount?: number }>;
}

export interface PendingNotificationState {
  pendingUpdates: Record<string, PendingUpdate[]> | Map<string, PendingUpdate[]>;
  pendingDiscounts: PendingDiscount[];
}

export interface NotificationStatePorts {
  history: NotificationHistoryPort;
  seen: SeenNotificationPort;
}
