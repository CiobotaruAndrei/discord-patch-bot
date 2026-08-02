import type { WatchlistGameSuggestionEntry, FutureReleaseGameEntry } from "../admin-records/adminRecordsTypes.js";
import type { NotificationMode, PendingUpdate, PendingDiscount, LastErrorInfo, PriceAlertRule } from "../notifications/notificationTypes.js";
import type { YouTubeChannelSubscription, YouTubeFilters, YouTubeChannelRoute } from "../youtube/youtubeTypes.js";
import type { AdminCommandAccessByCommand, AdminCommandAccessConfig } from "../command-security/adminCommandAccessScope.js";
import type { CurrencyCode } from "../../types.js";

export interface GuildSettingsIdentity {
  _id: string;
}

export interface GuildConfigurationSettings {
  subscribed?: boolean;
  notificationChannelId?: string | null;
  discountsSubscribed?: boolean;
  discountChannelId?: string | null;
  outboxRecoveryVerify?: boolean;
  minDiscountPercent?: number;
  includeFreeGames?: boolean;
  includePaidDiscounts?: boolean;
  notificationMode?: NotificationMode;
  updateMessageTemplate?: string | null;
  discountMessageTemplate?: string | null;
  currency?: CurrencyCode | string;
  enabledGames?: string[];
  commandSnoozes?: Map<string, Date | string | number> | Record<string, Date | string | number>;
  enabledStores?: string[];
  maxAbsolutePrice?: number;
  notificationRoleId?: string | null;
  discountRoleId?: string | null;
  adminAlertChannelId?: string | null;
  priceAlerts?: PriceAlertRule[];
  youtubeChannels?: YouTubeChannelSubscription[];
  youtubeNotificationChannelId?: string | null;
  youtubeNotificationsEnabled?: boolean;
  youtubeHasActivated?: boolean;
  youtubeFilters?: YouTubeFilters;
  youtubeMessageTemplate?: string | null;
  youtubeChannelRoutes?: YouTubeChannelRoute[];
  youtubeTitleIncludeWords?: string[];
  watchlistGameSuggestions?: WatchlistGameSuggestionEntry[];
  futureReleaseGames?: FutureReleaseGameEntry[];
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
  dlcSubscribed?: boolean;
  dlcChannelId?: string | null;
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  permissionRequestChannelId?: string | null;
  antiRaidAlertChannelId?: string | null;
  antiRaidThresholds?: Record<string, unknown> | null;
  antiRaidEnabled?: boolean;
  antiRaidDryRunEnabled?: boolean;
  adAlertChannelId?: string | null;
  adProtectionEnabled?: boolean;
  moderationGuardEnabled?: boolean;
  warningChannelId?: string | null;
  purgeAmount?: number;
  lockedChannelIds?: string[];
  lockedChannelPermissions?: Array<{
    channelId: string;
    sendMessages: "allow" | "deny" | "inherit";
  }>;
}

export interface GuildSecuritySettings {
  adminCommandAccess?: AdminCommandAccessConfig | null;
  adminCommandAccessByCommand?: AdminCommandAccessByCommand | null;
}

export interface GuildOperationalSettings {
  pendingUpdates?: Map<string, PendingUpdate[]> | Record<string, PendingUpdate[]>;
  pendingDiscounts?: PendingDiscount[];
  lastProcessedGameKey?: string | null;
  updatesInitializing?: boolean;
  updatesActivationId?: string | null;
  updatesLastError?: LastErrorInfo;
  discountsInitializing?: boolean;
  discountsActivationId?: string | null;
  discountsLastError?: LastErrorInfo;
  futureReleaseInitializing?: boolean;
  futureReleaseActivationId?: string | null;
  dlcInitializing?: boolean;
  dlcActivationId?: string | null;
  dlcLastError?: LastErrorInfo;
  seenHashVersionUpdates?: number;
  seenHashVersionDiscounts?: number;
}

export type GuildSettings = GuildSettingsIdentity & GuildConfigurationSettings & GuildSecuritySettings & GuildOperationalSettings;
