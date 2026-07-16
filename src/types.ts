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

export interface MongoWriteOutcome {
  matchedCount?: number;
  modifiedCount?: number;
  upsertedCount?: number;
}

export interface ParseEnvNumberLimits {
  min?: number;
  max?: number;
}

export interface RequestContextStore {
  requestId?: string;
  abortSignal?: AbortSignal | null;
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

export interface PaginationButtonInteraction {
  user: { id: string };
  customId: string;
  reply(payload: unknown): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
}

export interface ComponentCollector {
  on(event: "collect", listener: (button: PaginationButtonInteraction) => unknown): this;
  on(event: "end", listener: () => unknown): this;
  stop(reason?: string): void;
}

export interface InteractionMessage {
  editable?: boolean;
  edit(payload: unknown): Promise<unknown>;
  createMessageComponentCollector(options: unknown): ComponentCollector;
}

export interface SystemTimes {
  all: number;
  single: number;
  reduceri: number;
  [key: string]: number;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface CommandRuntimeCache {
  updates: CacheEntry<FetchResult[] | null>;
  dealsByCurrency: Map<string, CacheEntry<DealInfo[]>>;
  single: Map<string, CacheEntry<NormalizedUpdate | null>>;
  dlc: Map<string, CacheEntry<DlcCacheEntry>>;
}

export interface CommandCacheSizes {
  single: number;
  dlc: number;
  updatesValid: boolean;
  dealsCurrenciesValid: number;
  userCooldowns: number;
}

export interface CooldownResult {
  allowed: boolean;
  remainingMs?: number;
}

export interface HttpRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  data?: unknown;
  responseType?: "arraybuffer" | "json" | "text";
  largeJson?: boolean;
  maxContentLength?: number;
  maxBodyLength?: number;
  signal?: AbortSignal;
  acceptNotModified?: boolean;
  [key: string]: unknown;
}

export interface ConcurrentRunResult<T> {
  processed: number;
  errors: Array<{
    index: number;
    item: T;
    error: unknown;
  }>;
}
