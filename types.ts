export type GameType =
  | "steam"
  | "minecraft"
  | "epic_games"
  | "roblox"
  | "listing_based"
  | "nvidia"
  | "amd"
  | "intel";

export type CurrencyCode = "USD" | "EUR" | "GBP" | "RON";

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
  [key: string]: unknown;
}

export interface BotConfig {
  checkIntervalMinutes?: number;
  games: GameConfig[];
}

export interface BotMetrics {
  fetchSuccess: number;
  fetchFail: number;
  httpRetries: number;
  rateLimitHits: number;
  cronRuns: number;
  cronErrors: number;
  cronSkippedDueToLock: number;
  cronAborted: number;
  httpRateLimitDrops: number;
  startedAt: number;
}

export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
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

export interface DealInfo {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  store?: string;
  appId?: string;
  steamAppID?: string | number | null;
  normalPrice?: string | number;
  salePrice?: string | number;
  savings?: string | number;
  discountPercent?: number;
  popularityScore?: number;
  totalReviews?: number;
  qualityScore?: number;
  currency?: string;
  image?: string | null;
  thumbnail?: string | null;
  endsAt?: string | Date | null;
  endDateStr?: string | null;
  extraDetails?: string;
  enriched?: boolean;
  [key: string]: unknown;
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

export interface GuildSettings {
  _id: string;
  subscribed?: boolean;
  notificationChannelId?: string | null;
  seen?: Map<string, string[]> | Record<string, string[]>;
  pendingUpdates?: Map<string, PendingUpdate[]> | Record<string, PendingUpdate[]>;
  discountsSubscribed?: boolean;
  discountChannelId?: string | null;
  seenDiscounts?: string[];
  pendingDiscounts?: PendingDiscount[];
  minDiscountPercent?: number;
  includeFreeGames?: boolean;
  includePaidDiscounts?: boolean;
  notificationMode?: "compact" | "detailed";
  currency?: CurrencyCode | string;
  lastProcessedGameKey?: string | null;
  updatesInitializing?: boolean;
  updatesActivationId?: string | null;
  updatesLastError?: LastErrorInfo;
  discountsInitializing?: boolean;
  discountsActivationId?: string | null;
  discountsLastError?: LastErrorInfo;
  enabledGames?: string[];
  enabledStores?: string[];
  maxAbsolutePrice?: number;
  notificationRoleId?: string | null;
  discountRoleId?: string | null;
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
  updates: CacheEntry<unknown | null>;
  dealsByCurrency: Map<string, CacheEntry<DealInfo[]>>;
  single: Map<string, CacheEntry<PatchUpdate | null>>;
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
