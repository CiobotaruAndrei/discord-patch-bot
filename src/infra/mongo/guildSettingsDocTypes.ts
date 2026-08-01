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

export interface NotificationLastError {
  message?: string;
  channelId?: string | null;
  at?: Date | null;
}

export interface WatchlistGameSuggestionEntry {
  gameName: string;
  createdBy: string;
  createdAt: Date;
}

export interface FutureReleaseGameEntry {
  gameName: string;
  addedBy: string;
  addedAt: Date;
  releaseDate?: string;
  preorderPrice?: string;
  sourceAppId?: string;
  baselineDone?: boolean;
  notifiedThresholdDays?: number[];
  preorderSeen?: boolean;
  observedPreorderPrice?: string | null;
  stateRevision?: number;
  lastCheckedAt?: Date | null;
}

export interface AdminCommandAccessConfig {
  mode: "role" | "role-or-higher";
  roleId: string;
  updatedBy: string;
  updatedAt: Date;
}

export interface GuildDoc {
  _id: string;
  subscribed?: boolean;
  notificationChannelId?: string | null;
  pendingUpdates?: Map<string, PendingUpdateEntry[]> | Record<string, PendingUpdateEntry[]>;
  discountsSubscribed?: boolean;
  discountChannelId?: string | null;
  pendingDiscounts?: PendingDiscountEntry[];
  minDiscountPercent?: number;
  includeFreeGames?: boolean;
  includePaidDiscounts?: boolean;
  notificationMode?: "compact" | "detailed";
  updateMessageTemplate?: string | null;
  discountMessageTemplate?: string | null;
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
  commandSnoozes?: Map<string, Date> | Record<string, Date>;
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
    absentCycles?: number;
  }>;
  youtubeChannels?: Array<{
    channelId: string;
    channelName: string;
    channelUrl: string;
    subscribedAt: Date;
    lastCheckedAt?: Date | null;
    lastVideoId?: string;
    lastError?: NotificationLastError;
  }>;
  youtubeNotificationChannelId?: string | null;
  youtubeNotificationsEnabled?: boolean;
  youtubeHasActivated?: boolean;
  youtubeFilters?: {
    excludeShorts?: boolean;
    excludeLives?: boolean;
    excludePremieres?: boolean;
    minDurationSeconds?: number;
  };
  youtubeMessageTemplate?: string | null;
  youtubeChannelRoutes?: Array<{
    channelId: string;
    discordChannelIds: string[];
  }>;
  youtubeTitleIncludeWords?: string[];
  watchlistGameSuggestions?: WatchlistGameSuggestionEntry[];
  futureReleaseGames?: FutureReleaseGameEntry[];
  adminCommandAccess?: AdminCommandAccessConfig | null;
  adminCommandAccessByCommand?: Record<string, AdminCommandAccessConfig | null | undefined>;
  moderationTimeouts?: Array<{
    schemaVersion?: number;
    userId: string;
    username: string;
    moderatorId: string;
    appliedAt: Date;
    expiresAt?: Date | null;
    reason?: string;
  }>;
  moderationMutes?: Array<{
    schemaVersion?: number;
    userId: string;
    username: string;
    moderatorId: string;
    appliedAt: Date;
    expiresAt?: Date | null;
    reason?: string;
  }>;
  moderationWarnings?: Array<{
    schemaVersion?: number;
    warningId?: string;
    userId: string;
    username: string;
    moderatorId: string;
    warnedAt: Date;
  }>;
  moderationWarnBanLimit?: number;
  playerCountSubscribed?: boolean;
  playerCountChannelId?: string | null;
  playerCountGames?: string[];
  playerCountInitializing?: boolean;
  playerCountActivationId?: string | null;
  playerCountWatchState?: Array<{
    gameKey: string;
    appId: string;
    playerCount: number;
    fetchedAt: Date;
    lastNotifiedAt?: Date | null;
    lastDirection?: "up" | "down" | null;
  }>;
  gameAliases?: Map<string, string[]> | Record<string, string[]>;
  timezone?: string;
  futureReleaseSubscribed?: boolean;
  futureReleaseChannelId?: string | null;
  futureReleaseInitializing?: boolean;
  futureReleaseActivationId?: string | null;
  dlcSubscribed?: boolean;
  dlcChannelId?: string | null;
  dlcInitializing?: boolean;
  dlcActivationId?: string | null;
  dlcLastError?: NotificationLastError;
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  botAddAlertChannelId?: string | null;
  permissionRequestChannelId?: string | null;
  antiRaidAlertChannelId?: string | null;
  antiRaidThresholds?: Record<string, unknown> | null;
  moderationGuardEnabled?: boolean;
  botAddProtectionEnabled?: boolean;
  botObservations?: Array<{
    botId: string;
    requesterId: string;
    approval: "owner" | "one-time" | "unapproved-removal-failed";
    initialRisk: "normal" | "suspicious" | "dangerous";
    joinedAt: Date;
    observeUntil: Date;
    lastActivityAt: Date;
    eventKeys: string[];
    recentEvents: Array<{ key: string; kind: string; at: Date; confirmed: boolean }>;
    lastBurstAlertAt?: Date | null;
  }>;
  warningChannelId?: string | null;
  botAddPermissions?: Array<{
    requestId: string;
    botId: string;
    requesterId: string;
    requestedAt: Date;
    ownerId?: string | null;
    respondedAt?: Date | null;
    expiresAt?: Date | null;
    usedAt?: Date | null;
    cancelledAt?: Date | null;
    cancellationReason?: "protection-stopped" | null;
    status: "pending" | "approved" | "used" | "rejected" | "expired" | "cancelled";
  }>;
  purgeAmount?: number;
  lockedChannelIds?: string[];
  lockedChannelPermissions?: Array<{
    channelId: string;
    sendMessages: "allow" | "deny" | "inherit";
  }>;
}
