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
  BotConfig,
  ConfigLoadResult
} from "./config/configTypes.js";
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

export interface RuntimeEnv {
  MONGO_URI?: string;
  DISCORD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  REDIS_URL?: string;
  BOT_ROLE: BotRole;
  DISCORD_DEV_GUILD_ID: string;
  PORT: string;
  NODE_ENV: string;
  METRICS_TOKEN: string;
  METRICS_PUBLIC: boolean;
  NOTIFICATION_OUTBOX_ENABLED: boolean;
  NOTIFICATION_OUTBOX_DRAIN_LIMIT: number;
  NOTIFICATION_OUTBOX_MAX_AGE_MS: number;
  NOTIFICATION_OUTBOX_RECOVERY_VERIFY: boolean;
  NOTIFICATION_OUTBOX_RECOVERY_STRICT: boolean;
  NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: number;
  NOTIFICATION_OUTBOX_SENT_TTL_HOURS: number;
  NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS: string[];
  BOT_SENSITIVE_USER_IDS: string[];
  BOT_GLOBAL_ACCESS_CODE: string;
  BOT_GLOBAL_ACCESS_CODE_HASH: string;
  NOTIFICATION_HISTORY_TTL_DAYS: number;
  NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: number;
  GUILD_SEEN_DISCOUNT_TTL_DAYS: number;
  GUILD_AUDIT_LOG_TTL_DAYS: number;
  FEEDBACK_REPORT_TTL_DAYS: number;
  MIGRATIONS_CONTINUE_ON_ERROR: boolean;
  ALLOW_DEFAULT_PROXIES: boolean;
  TRUST_PROXY: boolean;
  TRUSTED_PROXY_COUNT: number;
  ADMIN_WEBHOOK_URL: string;
  LOG_LEVEL: string;
  PROXY_URLS: string;
  FETCH_CONCURRENCY: number;
  FETCH_CONCURRENCY_STEAM: number;
  FETCH_CONCURRENCY_EPIC: number;
  FETCH_CONCURRENCY_LISTING: number;
  FETCH_CONCURRENCY_DRIVER: number;
  MAX_HTML_BYTES: number;
  MAX_JSON_BYTES: number;
  MAX_DEALS: number;
  STEAM_SPECIALS_LIMIT: number;
  EPIC_SPECIALS_LIMIT: number;
  STEAM_REVIEW_BATCH_SIZE: number;
  STEAM_REVIEW_BATCH_DELAY_MS: number;
  DISCORD_SEND_DELAY_MS: number;
  DISCORD_SEND_RATE_CAPACITY: number;
  DISCORD_SEND_RATE_PER_SEC: number;
  DISCORD_SEND_RATE_MAX_WAIT_MS: number;
  MAX_UPDATES_PER_CYCLE: number;
  MAX_DEALS_PER_CYCLE: number;
  GUILD_PROCESS_CONCURRENCY: number;
  SEEN_PER_GAME_LIMIT: number;
  DEALS_HISTORY_LIMIT: number;
  PENDING_UPDATES_PER_GAME_LIMIT: number;
  PENDING_DISCOUNTS_LIMIT: number;
  PENDING_UPDATE_MAX_AGE_MS: number;
  PENDING_DISCOUNT_GRACE_CYCLES: number;
  PRICE_ALERT_REARM_ABSENT_CYCLES: number;
  PENDING_UPDATE_MAX_ATTEMPTS: number;
  PENDING_DISCOUNT_MAX_ATTEMPTS: number;
  MAX_FUZZY_SEARCH_INPUT: number;
  INFLIGHT_PROMISE_TIMEOUT_MS: number;
  USER_COMMAND_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_FAIL_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_JITTER_MS: number;
  SCHEMA_DRIFT_THRESHOLD: number;
  COLLECTOR_TIMEOUT_MS: number;
  HOUSEKEEPING_INTERVAL_MS: number;
  GLOBAL_HEALTH_WINDOW: number;
  GLOBAL_HEALTH_MIN_RATIO: number;
  GUILD_CACHE_TTL_MS: number;
  GUILD_CACHE_MAX_SIZE: number;
  ADMIN_ALERT_COOLDOWN_MS: number;
  SHUTDOWN_DRAIN_MS: number;
  ENRICHED_DEAL_CACHE_TTL_MS: number;
  ENRICHED_DEAL_CACHE_MAX_SIZE: number;
  CACHE_TTL_MS: number;
  SINGLE_CACHE_MAX_SIZE: number;
  DLC_CACHE_MAX_SIZE: number;
  DEALS_CURRENCY_CACHE_MAX_SIZE: number;
  ITEMS_PER_PAGE: number;
  DLC_ITEMS_PER_PAGE: number;
  COMMAND_OUTPUT_MAX_CHARS: number;
  MONGO_MAX_POOL_SIZE: number;
  MONGO_RETRY_ATTEMPTS: number;
  HTTP_RATE_LIMIT_REQ: number;
  HTTP_RATE_LIMIT_WINDOW_MS: number;
  isProd: boolean;
}

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

export interface GuildSettings {
  _id: string;
  subscribed?: boolean;
  notificationChannelId?: string | null;
  pendingUpdates?: Map<string, PendingUpdate[]> | Record<string, PendingUpdate[]>;
  discountsSubscribed?: boolean;
  discountChannelId?: string | null;
  pendingDiscounts?: PendingDiscount[];
  outboxRecoveryVerify?: boolean;
  minDiscountPercent?: number;
  includeFreeGames?: boolean;
  includePaidDiscounts?: boolean;
  notificationMode?: NotificationMode;
  updateMessageTemplate?: string | null;
  discountMessageTemplate?: string | null;
  currency?: CurrencyCode | string;
  lastProcessedGameKey?: string | null;
  updatesInitializing?: boolean;
  updatesActivationId?: string | null;
  updatesLastError?: LastErrorInfo;
  discountsInitializing?: boolean;
  discountsActivationId?: string | null;
  discountsLastError?: LastErrorInfo;
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
  seenHashVersionUpdates?: number;
  seenHashVersionDiscounts?: number;
  [key: string]: unknown;
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
