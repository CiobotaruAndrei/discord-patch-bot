import type { IncomingMessage } from "http";

export type GameType =
  | "steam"
  | "minecraft"
  | "epic_games"
  | "roblox"
  | "listing_based"
  | "nvidia"
  | "amd"
  | "intel"
  | "rss";

export type CurrencyCode = "USD" | "EUR" | "GBP" | "RON";
export type NotificationMode = "compact" | "detailed";
export type AbortPredicate = (() => boolean) | null;
export type MaybePromise<T> = T | Promise<T>;
export type PriceValue = string | number;
export type CurrencyPlacement = "prefix" | "suffix";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LoggerFunction = (level: LogLevel | string, context: string, message: string, meta?: unknown) => void;
export type ParseEnvNumber = (name: string, defaultValue: number, limits?: ParseEnvNumberLimits) => number;
export type LockToken = string;
export type ActiveLocks = Map<string, LockToken>;

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
  NOTIFICATION_HISTORY_TTL_DAYS: number;
  NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: number;
  GUILD_SEEN_DISCOUNT_TTL_DAYS: number;
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

export interface GameSourceFallback {
  type: GameType;
  url?: string;
  listingUrl?: string;
  listingUrls?: string[];
  baseUrl?: string;
}

export interface GameConfig {
  key: string;
  name: string;
  type?: GameType;
  appId?: string;
  listingUrl?: string;
  listingUrls?: string[];
  baseUrl?: string;
  articleHrefRegex?: string;
  requireKeywords?: string[];
  thumbnail?: string;
  url?: string;
  aliases?: string[];
  upCRD?: 0 | 1;
  fallbacks?: GameSourceFallback[];
  [key: string]: unknown;
}

export interface BotConfig {
  checkIntervalMinutes?: number;
  games: GameConfig[];
}

export interface ConfigLoadResult {
  config: BotConfig;
  games: GameConfig[];
  configPath: string;
}

export interface BotMetrics {
  fetchSuccess: number;
  fetchFail: number;
  httpRetries: number;
  rateLimitHits: number;
  cronRuns: number;
  cronErrors: number;
  cronSkippedDueToLock: number;
  cronSkippedDueToHealth: number;
  cronAborted: number;
  httpRateLimitDrops: number;
  httpHandlerErrors: number;
  outboxSent: number;
  outboxRetried: number;
  outboxDeadLettered: number;
  outboxExpired: number;
  outboxDrains: number;
  outboxQueueDepth: number;
  outboxDeliveryMsTotal: number;
  outboxOldestJobAgeSeconds: number;
  outboxFutureScheduledJobs: number;
  outboxLockAcquireFailures: number;
  outboxPauseCheckFailures: number;
  outboxRecoveryDuplicates: number;
  outboxRecoveryFetches: number;
  outboxRecoveryFailures: number;
  outboxRecoveryMarkerMissing: number;
  outboxMarkSentFailures: number;
  outboxDeleteFailures: number;
  outboxDeadLetterWriteFailures: number;
  outboxHistoryWriteFailures: number;
  outboxRecoveryVerifyEnabledGuilds: number;
  outboxLastDrainAt: number;
  startedAt: number;
}

export interface CronHealthSnapshot {
  successRatio: number | null;
  windowSize: number;
  healthSkipScheduled: boolean;
  avgDurationMs?: number;
}

export interface CronController {
  scheduleNextCron(): void;
  runCronCycle(): Promise<void>;
  stop(): void;
  shouldAbortCron(): boolean;
  getHealthSnapshot(): CronHealthSnapshot;
}

export interface LifecycleState {
  isShuttingDown: boolean;
}

export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitRequest {
  headers: IncomingMessage["headers"];
  socket?: { remoteAddress?: string };
}

export interface RateLimiter {
  check(req: RateLimitRequest): boolean;
  prune(): void;
  readonly size: number;
  readonly retryAfterSeconds: number;
}

export interface PatchUpdate {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  summary?: string;
  excerpt?: string;
  content?: string;
  fullText?: string;
  publishedAt?: string | Date;
  date?: string | Date;
  timestamp?: string | Date;
  author?: string;
  image?: string | null;
  thumbnail?: string | null;
  [key: string]: unknown;
}

export interface NormalizedUpdate {
  id: string;
  title: string;
  link: string;
  excerpt: string;
  fullText: string;
  image: string | null;
  thumbnail: string | null;
  timestamp: string;
}

export interface EmbeddableUpdate {
  title?: string;
  link?: string;
  excerpt?: string;
  image?: unknown;
  thumbnail?: unknown;
  timestamp?: string | Date;
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

export interface FetchResult {
  game: GameConfig;
  latest: NormalizedUpdate | null;
  error: string | null;
}

export interface DealInfo {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  store?: string;
  appId?: string;
  steamAppID?: string | number | null;
  normalPrice?: PriceValue;
  salePrice?: PriceValue;
  savings?: PriceValue;
  discountPercent?: number;
  popularityScore?: number;
  totalReviews?: number;
  qualityScore?: number;
  currency?: CurrencyCode | string;
  image?: string | null;
  thumbnail?: string | null;
  endsAt?: string | Date | null;
  endDateStr?: string | null;
  extraDetails?: string;
  enriched?: boolean;
  [key: string]: unknown;
}

export interface ValidatedDealInfo extends DealInfo {
  title: string;
  link: string;
  store: string;
  normalPrice: PriceValue;
  salePrice: PriceValue;
  savings: PriceValue;
}

export interface EnrichedDealInfo extends DealInfo {
  enriched: true;
}

export interface PendingUpdate extends PatchUpdate {
  id: string;
  attempts?: number;
  createdAt?: Date | string;
}

export interface PendingDiscount {
  hash: string;
  snapshot?: DealInfo | null;
  lastSeenAt?: Date | string;
  attempts?: number;
}

export interface LastErrorInfo {
  message?: string;
  channelId?: string | null;
  at?: Date | string | null;
}

export interface PriceAlertRule {
  gameKey: string;
  gameName: string;
  appId?: string;
  aliases?: string[];
  threshold: number;
  currency: CurrencyCode | string;
  triggeredAt?: Date | string | null;
  lastObservedPrice?: number | null;
  lastObservedAt?: Date | string | null;
  absentCycles?: number | null;
}

export interface ConfigBackupRecord {
  name: string;
  createdBy: string;
  createdAt: Date | string;
  snapshot: Record<string, unknown>;
}

export interface BotAuditLogEntry {
  userId: string;
  command: string;
  result: string;
  serverId: string;
  details?: string;
  at: Date | string;
}

export interface ServerAuditLogEntry {
  userId: string;
  action: string;
  serverId: string;
  details?: string;
  at: Date | string;
}

export interface SuggestedCommandEntry {
  commandName: string;
  description: string;
  createdBy: string;
  createdAt: Date | string;
}

export interface YouTubeChannelSubscription {
  channelId: string;
  channelName: string;
  channelUrl: string;
  subscribedAt: Date | string;
  lastCheckedAt?: Date | string | null;
  lastVideoId?: string;
  lastError?: LastErrorInfo;
}

export interface YouTubeFilters {
  excludeShorts?: boolean;
  excludeLives?: boolean;
  excludePremieres?: boolean;
  minDurationSeconds?: number;
}

export interface YouTubeChannelRoute {
  channelId: string;
  discordChannelIds: string[];
}

export interface YouTubeErrorEntry {
  channelId: string;
  channelName: string;
  message: string;
  at: Date | string;
}

export interface YouTubeVideo {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  link: string;
  publishedAt: string;
  thumbnail: string;
}

export interface YouTubeVideoMetadata {
  durationSeconds: number | null;
  isShort: boolean;
  isLive: boolean;
  isPremiere: boolean;
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
  youtubeErrors?: YouTubeErrorEntry[];
  configBackups?: ConfigBackupRecord[];
  botAuditLog?: BotAuditLogEntry[];
  serverAuditLog?: ServerAuditLogEntry[];
  suggestedCommands?: SuggestedCommandEntry[];
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

export interface DlcInfo {
  name: string;
  price: string;
}

export interface DlcCacheEntry {
  dlcList: DlcInfo[];
  title: string;
  appId: string | number;
  thumbUrl: string;
  totalExtracted: number;
}

export interface SteamSearchItem {
  id?: string | number;
  name?: string;
  type?: string;
  tiny_image?: string;
  price?: unknown;
  [key: string]: unknown;
}

export interface SteamReviewData {
  totalReviews: number;
  qualityPercent: number;
  success: boolean;
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

export interface FetchDealsOptions {
  currency?: CurrencyCode | string;
  fromCron?: boolean;
}

export interface ConcurrentRunResult<T> {
  processed: number;
  errors: Array<{
    index: number;
    item: T;
    error: unknown;
  }>;
}
