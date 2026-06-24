export interface PendingUpdateEntry {
  id: string;
  title?: string;
  link?: string;
  excerpt?: string;
  thumbnail?: string | null;
  image?: string | null;
  timestamp?: string;
  createdAt?: Date;
  attempts?: number;
}

export interface PendingDiscountEntry {
  hash: string;
  snapshot?: unknown;
  lastSeenAt?: Date;
  attempts?: number;
}

export interface DeadLetterEntry {
  kind: "update" | "discount";
  itemId?: string;
  title?: string;
  channelId?: string;
  dedupeKey?: string;
  reason?: string;
  attempts?: number;
  failedAt?: Date;
}

export interface NotificationLastError {
  message?: string;
  channelId?: string | null;
  at?: Date | null;
}

export interface GuildDoc {
  _id: string;
  subscribed?: boolean;
  notificationChannelId?: string | null;
  pendingUpdates?: Map<string, PendingUpdateEntry[]> | Record<string, PendingUpdateEntry[]>;
  discountsSubscribed?: boolean;
  discountChannelId?: string | null;
  pendingDiscounts?: PendingDiscountEntry[];
  notificationDeadLetter?: DeadLetterEntry[];
  minDiscountPercent?: number;
  includeFreeGames?: boolean;
  includePaidDiscounts?: boolean;
  notificationMode?: "compact" | "detailed";
  currency?: string;
  outboxRecoveryVerify?: boolean;
  lastProcessedGameKey?: string | null;
  seenHashVersionUpdates?: number;
  seenHashVersionDiscounts?: number;
  updatesInitializing?: boolean;
  updatesActivationId?: string | null;
  updatesLastError?: NotificationLastError;
  discountsInitializing?: boolean;
  discountsActivationId?: string | null;
  discountsLastError?: NotificationLastError;
  enabledGames?: string[];
  enabledStores?: string[];
  maxAbsolutePrice?: number;
  notificationRoleId?: string | null;
  discountRoleId?: string | null;
  adminAlertChannelId?: string | null;
  priceAlerts?: Array<{
    gameKey: string;
    gameName: string;
    appId?: string;
    aliases?: string[];
    threshold: number;
    currency: string;
    triggeredAt?: Date | null;
    lastObservedPrice?: number | null;
    lastObservedAt?: Date | null;
  }>;
}

export interface CircuitBreakerDoc {
  _id: string;
  fails?: number;
  cooldownUntil?: Date | null;
  alertSent?: boolean;
  schemaDriftFails?: number;
  schemaDriftAlertSent?: boolean;
}

export interface SystemDoc {
  _id: string;
  executionTimes?: {
    all?: number;
    single?: number;
    reduceri?: number;
  };
  outboxPaused?: boolean;
}

export interface JobLockDoc {
  _id: string;
  lockedUntil?: Date | null;
  ownerToken?: string | null;
}

export interface AdminAlertCooldownDoc {
  _id: string;
  lastSentAt?: Date;
}

export interface FetchSnapshotDoc {
  _id: string;
  payload?: unknown;
  fetchedAt?: Date;
}

export interface GuildSeenDiscountDoc {
  guildId: string;
  dealHash: string;
  seenAt?: Date;
}

export interface GuildSeenUpdateDoc {
  guildId: string;
  gameKey: string;
  updateId: string;
  seenAt?: Date;
}

export interface OutboxHistoryEntry {
  kind: "update" | "discount";
  gameKey?: string;
  title?: string;
  link?: string;
}

export interface NotificationOutboxDoc {
  guildId: string;
  channelId: string;
  kind: "update" | "discount";
  payload: unknown;
  attempts?: number;
  deliveries?: number;
  availableAt?: Date;
  lockedUntil?: Date | null;
  lockedBy?: string | null;
  dedupeKey?: string;
  recoveryVerify?: boolean | null;
  history?: OutboxHistoryEntry[];
  createdAt?: Date;
}

export interface NotificationOutboxSentDoc {
  dedupeKey: string;
  sentAt?: Date;
}

export interface NotificationHistoryDoc {
  guildId: string;
  kind: "update" | "discount";
  gameKey?: string;
  title?: string;
  link?: string;
  sentAt?: Date;
}

export interface FeedbackReportDoc {
  guildId: string;
  userId?: string;
  type: string;
  gameKey?: string;
  detail?: string;
  createdAt?: Date;
}

export interface NotificationDeadLetterReplayDoc {
  guildId: string;
  kind: "update" | "discount";
  channelId: string;
  payload: unknown;
  dedupeKey?: string;
  recoveryVerify?: boolean;
  reason?: string;
  itemId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
