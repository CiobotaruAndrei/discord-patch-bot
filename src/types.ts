import type {
  ConfigBackupRecord,
  BotAuditLogEntry,
  ServerAuditLogEntry,
  SuggestedCommandEntry,
  WatchlistGameSuggestionEntry,
  FutureReleaseGameEntry
} from "./features/admin-records/adminRecordsTypes.js";
import type {
  NotificationMode,
  PendingUpdate,
  PendingDiscount,
  LastErrorInfo,
  PriceAlertRule,
  DeadLetterEntry
} from "./features/notifications/notificationTypes.js";
import type {
  YouTubeChannelSubscription,
  YouTubeFilters,
  YouTubeChannelRoute,
  YouTubeErrorEntry
} from "./features/youtube/youtubeTypes.js";
import type {
  NormalizedUpdate,
  FetchResult,
  DealInfo,
  DlcCacheEntry
} from "./sources/sourceTypes.js";
import type { GuildSettings } from "./features/guild-config/guildSettingsTypes.js";
import type { RuntimeEnv } from "./config/runtimeEnvTypes.js";

export type {
  ConfigBackupRecord,
  BotAuditLogEntry,
  ServerAuditLogEntry,
  SuggestedCommandEntry,
  WatchlistGameSuggestionEntry,
  FutureReleaseGameEntry
} from "./features/admin-records/adminRecordsTypes.js";
export type {
  NotificationMode,
  PendingUpdate,
  PendingDiscount,
  LastErrorInfo,
  PriceAlertRule,
  DeadLetterEntry
} from "./features/notifications/notificationTypes.js";
export type {
  YouTubeChannelSubscription,
  YouTubeFilters,
  YouTubeChannelRoute,
  YouTubeErrorEntry,
  YouTubeVideo,
  YouTubeVideoMetadata
} from "./features/youtube/youtubeTypes.js";
export type {
  PatchUpdate,
  NormalizedUpdate,
  EmbeddableUpdate,
  FetchResult,
  DealInfo,
  ValidatedDealInfo,
  EnrichedDealInfo,
  DlcInfo,
  DlcCacheEntry,
  SteamSearchItem,
  SteamReviewData,
  FetchDealsOptions
} from "./sources/sourceTypes.js";
export type {
  GameType,
  GameSourceFallback,
  GameConfig,
  NormalizedGameConfig,
  NormalizedGameSourceFallback,
  BotConfig,
  ConfigLoadResult
} from "./config/configTypes.js";
export type {
  GuildSettings,
  GuildSettingsIdentity,
  GuildConfigurationSettings,
  GuildSecuritySettings,
  GuildOperationalSettings
} from "./features/guild-config/guildSettingsTypes.js";
export type {
  RuntimeEnv,
  RuntimeIdentityEnv,
  NotificationPersistenceEnv,
  NetworkRuntimeEnv,
  NotificationDeliveryEnv,
  ReliabilityRuntimeEnv,
  CacheRuntimeEnv
} from "./config/runtimeEnvTypes.js";
export type { BotMetrics } from "./app/health/metricsTypes.js";
export type {
  RateLimitBucket,
  RateLimitRequest,
  RateLimiter
} from "./app/health/rateLimitTypes.js";
export type {
  CronHealthSnapshot,
  CronController
} from "./app/scheduler/schedulerTypes.js";

export type CurrencyCode = "USD" | "EUR" | "GBP" | "RON";
export type BotRole = "all" | "web" | "worker";
export type DiscordReplyPayload = string | Record<string, unknown>;
export type AbortPredicate = (() => boolean) | null;
export type MaybePromise<T> = T | Promise<T>;
export type PriceValue = string | number;
export type CurrencyPlacement = "prefix" | "suffix";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LoggerFunction = (level: LogLevel | string, context: string, message: string, meta?: unknown) => void;
export type ParseEnvNumber = (name: string, defaultValue: number, limits?: ParseEnvNumberLimits) => number;
export type LockToken = string;
export type ActiveLocks = Map<string, LockToken>;

export type { WriteCounts as MongoWriteOutcome } from "./shared/persistenceOutcome.js";

export interface ParseEnvNumberLimits {
  min?: number;
  max?: number;
}

export interface CurrencyConfig {
  cc: string;
  symbol: string;
  placement: CurrencyPlacement;
}

export type CurrencyRegistry = Record<CurrencyCode, CurrencyConfig>;

export interface LifecycleState {
  isShuttingDown: boolean;
}

export interface SystemTimes {
  all: number;
  single: number;
  reduceri: number;
  [key: string]: number;
}

export type {
  CacheEntry,
  CommandCacheSizes,
  CommandRuntimeCache
} from "./features/command-cache/commandCacheTypes.js";
export type { CooldownResult } from "./features/command-cache/cooldownTypes.js";
export type { HttpRequestOptions } from "./sources/httpRequestTypes.js";

export type {
  ComponentCollector,
  InteractionMessage,
  PaginationButtonInteraction
} from "./features/command-presentation/paginationTypes.js";

export type { RequestContextStore } from "./shared/requestContextTypes.js";
