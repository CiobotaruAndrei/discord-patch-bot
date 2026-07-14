export interface OutboxHistoryEntry {
  kind: "update" | "discount" | "youtube";
  gameKey?: string;
  title?: string;
  link?: string;
}

export interface NotificationOutboxDoc {
  guildId: string;
  channelId: string;
  kind: "update" | "discount" | "youtube";
  payload: unknown;
  attempts?: number;
  deliveries?: number;
  availableAt?: Date;
  lockedUntil?: Date | null;
  lockedBy?: string | null;
  dedupeKey?: string;
  recoveryVerify?: boolean | null;
  manual?: boolean;
  history?: OutboxHistoryEntry[];
  deliveryAcceptedAt?: Date | null;
  status?: "queued" | "leased" | "delivered-pending" | "delivered" | "dead-lettered" | "dropped";
  createdAt?: Date;
}

export interface NotificationOutboxSentDoc {
  dedupeKey: string;
  sentAt?: Date;
}

export interface NotificationHistoryDoc {
  guildId: string;
  kind: "update" | "discount" | "youtube";
  gameKey?: string;
  title?: string;
  link?: string;
  sentAt?: Date;
}

export interface NotificationDeadLetterReplayDoc {
  guildId: string;
  kind: "update" | "discount" | "youtube";
  channelId: string;
  payload: unknown;
  dedupeKey?: string;
  recoveryVerify?: boolean;
  reason?: string;
  itemId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
