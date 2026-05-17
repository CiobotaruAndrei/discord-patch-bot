import type {
  CacheEntry,
  CommandCacheSizes,
  CommandRuntimeCache,
  CooldownResult,
  DealInfo,
  DlcCacheEntry,
  FetchResult,
  NormalizedUpdate,
  RuntimeEnv
} from "../../types";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface CommandCacheContext {
  crypto: {
    randomBytes(size: number): { toString(encoding: BufferEncoding): string };
  };
  PermissionsBitField: any;
  logger: Logger;
  DEFAULT_CURRENCY: string;
  env: RuntimeEnv;
  [key: string]: unknown;
}

const CACHE_CLEAN_INTERVAL_MS = 300000;
const USER_COOLDOWNS_THRESHOLD = 500;

function attachCommandCache(ctx: CommandCacheContext): void {
  const { crypto, PermissionsBitField, logger, DEFAULT_CURRENCY, env } = ctx;

const CACHE_TTL_MS = env.CACHE_TTL_MS;
const ITEMS_PER_PAGE = env.ITEMS_PER_PAGE;
const DLC_ITEMS_PER_PAGE = env.DLC_ITEMS_PER_PAGE;
const COMMAND_OUTPUT_MAX_CHARS = env.COMMAND_OUTPUT_MAX_CHARS;
const DLC_CACHE_MAX_SIZE = env.DLC_CACHE_MAX_SIZE;
const SINGLE_CACHE_MAX_SIZE = env.SINGLE_CACHE_MAX_SIZE;
const DEALS_CURRENCY_CACHE_MAX_SIZE = env.DEALS_CURRENCY_CACHE_MAX_SIZE;

const DEALS_HISTORY_LIMIT = env.DEALS_HISTORY_LIMIT;
const SEEN_PER_GAME_LIMIT = env.SEEN_PER_GAME_LIMIT;
const PENDING_UPDATES_PER_GAME_LIMIT = env.PENDING_UPDATES_PER_GAME_LIMIT;
const PENDING_DISCOUNTS_LIMIT = env.PENDING_DISCOUNTS_LIMIT;
const PENDING_UPDATE_MAX_AGE_MS = env.PENDING_UPDATE_MAX_AGE_MS;
const PENDING_DISCOUNT_GRACE_CYCLES = env.PENDING_DISCOUNT_GRACE_CYCLES;
const PENDING_UPDATE_MAX_ATTEMPTS = env.PENDING_UPDATE_MAX_ATTEMPTS;
const PENDING_DISCOUNT_MAX_ATTEMPTS = env.PENDING_DISCOUNT_MAX_ATTEMPTS;
const MAX_UPDATES_PER_CYCLE = env.MAX_UPDATES_PER_CYCLE;
const MAX_DEALS_PER_CYCLE = env.MAX_DEALS_PER_CYCLE;
const DISCORD_SEND_DELAY_MS = env.DISCORD_SEND_DELAY_MS;
const GUILD_PROCESS_CONCURRENCY = env.GUILD_PROCESS_CONCURRENCY;
const MAX_FUZZY_SEARCH_INPUT = env.MAX_FUZZY_SEARCH_INPUT;
const USER_COMMAND_COOLDOWN_MS = env.USER_COMMAND_COOLDOWN_MS;
const COLLECTOR_TIMEOUT_MS = env.COLLECTOR_TIMEOUT_MS;

// V9: constante pentru culori embed (eliminăm magic numbers împrăștiate)
const COLORS = Object.freeze({
  ERROR:    0xe74c3c,
  SUCCESS:  0x57f287,
  FREE:     0xffd700,
  INFO:     0x3498db,
  DARK:     0x2b2d31,
  DLC:      0x9b59b6,
  POSITIVE: 0x2ecc71
});

// V9: opțiuni pentru updates operaționale — frozen, în loc să le construim
// la fiecare apel cu o funcție.
const OP_UPDATE_OPTS = Object.freeze({ strict: false });

let GLOBAL_CACHE_TTL_MS = 1800000;
function setGlobalCacheTtl(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) {
    GLOBAL_CACHE_TTL_MS = Math.min(ms, 30 * 60 * 1000);
    logger("INFO", "CACHE", `GLOBAL_CACHE_TTL_MS setat la ${GLOBAL_CACHE_TTL_MS}ms`);
  }
}

// V9: normalizare cheie currency în cache (defensiv)
function normalizeCurrencyKey(c: unknown): string {
  return String(c || DEFAULT_CURRENCY).toUpperCase();
}

const cache: CommandRuntimeCache = {
  updates: { data: null, expiresAt: 0 },
  dealsByCurrency: new Map<string, CacheEntry<DealInfo[]>>(),
  single: new Map<string, CacheEntry<NormalizedUpdate | null>>(),
  dlc: new Map<string, CacheEntry<DlcCacheEntry>>()
};

function getUpdatesCacheData(): FetchResult[] | null {
  if (!cache.updates.data) return null;
  if (cache.updates.expiresAt <= Date.now()) {
    cache.updates = { data: null, expiresAt: 0 };
    return null;
  }
  return cache.updates.data;
}

function setUpdatesCache(data: FetchResult[] | null): void {
  cache.updates = { data, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
}

function getDealsCacheData(currency: unknown): DealInfo[] | null {
  const key = normalizeCurrencyKey(currency);
  const entry = cache.dealsByCurrency.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.dealsByCurrency.delete(key);
    return null;
  }
  cache.dealsByCurrency.delete(key);
  cache.dealsByCurrency.set(key, entry);
  return entry.data;
}

function setDealsCache(currency: unknown, data: DealInfo[]): void {
  const key = normalizeCurrencyKey(currency);
  if (cache.dealsByCurrency.has(key)) cache.dealsByCurrency.delete(key);
  cache.dealsByCurrency.set(key, { data, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS });
  evictLRU(cache.dealsByCurrency, DEALS_CURRENCY_CACHE_MAX_SIZE);
}

function cacheGetLRU<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const value = map.get(key);
  if (!value) return null;
  if (value.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  map.delete(key);
  map.set(key, value);
  return value.data;
}

// V9: helper unificat de eviction. Folosit și de cacheSetLRU,
// și de cleanCache. Evită bucle while care recreează iteratorul.
function evictLRU<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size <= maxSize) return;
  const toDelete = map.size - maxSize;
  let deleted = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++deleted >= toDelete) break;
  }
}

function cacheSetLRU<T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number, maxSize: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, { data, expiresAt: Date.now() + ttlMs });
  evictLRU(map, maxSize);
}

const userCommandCooldowns = new Map<string, number>();

function checkUserCooldown(userId: unknown, command: string): CooldownResult {
  if (USER_COMMAND_COOLDOWN_MS === 0) return { allowed: true };
  const key = `${userId}:${command}`;
  const last = userCommandCooldowns.get(key) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < USER_COMMAND_COOLDOWN_MS) {
    return { allowed: false, remainingMs: USER_COMMAND_COOLDOWN_MS - elapsed };
  }
  userCommandCooldowns.set(key, now);
  if (userCommandCooldowns.size > USER_COOLDOWNS_THRESHOLD) cleanUserCooldowns();
  return { allowed: true };
}

function cleanUserCooldowns(): void {
  if (USER_COMMAND_COOLDOWN_MS === 0) {
    userCommandCooldowns.clear();
    return;
  }
  const now = Date.now();
  for (const [key, ts] of userCommandCooldowns.entries()) {
    if (now - ts > USER_COMMAND_COOLDOWN_MS * 2) userCommandCooldowns.delete(key);
  }
}

function cleanCache(): void {
  const now = Date.now();
  if (cache.updates.expiresAt <= now) cache.updates = { data: null, expiresAt: 0 };
  for (const [currency, entry] of cache.dealsByCurrency.entries()) {
    if (entry.expiresAt <= now) cache.dealsByCurrency.delete(currency);
  }
  for (const [key, value] of cache.single.entries()) {
    if (value.expiresAt <= now) cache.single.delete(key);
  }
  for (const [key, value] of cache.dlc.entries()) {
    if (value.expiresAt <= now) cache.dlc.delete(key);
  }
  evictLRU(cache.dealsByCurrency, DEALS_CURRENCY_CACHE_MAX_SIZE);
  evictLRU(cache.single, SINGLE_CACHE_MAX_SIZE);
  evictLRU(cache.dlc, DLC_CACHE_MAX_SIZE);
  cleanUserCooldowns();
}

function getCacheSizes(): CommandCacheSizes {
  return {
    single: cache.single.size,
    dlc: cache.dlc.size,
    updatesValid: cache.updates.expiresAt > Date.now(),
    dealsCurrenciesValid: cache.dealsByCurrency.size,
    userCooldowns: userCommandCooldowns.size
  };
}

function startCacheCleaner(): ReturnType<typeof setInterval> {
  const handle = setInterval(cleanCache, CACHE_CLEAN_INTERVAL_MS);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

function smoothTime(oldMs: number, newMs: number, alpha = 0.3): number {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}

function formatUserError(err: unknown, defaultMsg = "A aparut o eroare interna.", errorCode: string | null = null): string {
  const detail = err && typeof err === "object"
    ? ((err as { stack?: unknown; message?: unknown }).stack || (err as { message?: unknown }).message || err)
    : err;
  if (err) logger("WARN", "USER_COMMAND", `${defaultMsg}${errorCode ? ` [${errorCode}]` : ""}`, detail);
  const suffix = errorCode ? ` \`[${errorCode}]\`` : "";
  return `Eroare: ${defaultMsg}${suffix}`;
}

function canSendEmbeds(channel: any, botId: string): boolean {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return !!perms && perms.has([
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks
  ]);
}

function missingChannelPermsMessage(): string {
  return "Eroare: Nu pot activa notificarile pe acest canal. Am nevoie de permisiunile **Send Messages** si **Embed Links**.";
}

function makeActivationId(): string {
  return crypto.randomBytes(8).toString("hex");
}

async function sleepIfPositive(ms: number): Promise<void> {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

  Object.assign(ctx, {
    CACHE_TTL_MS,
    CACHE_CLEAN_INTERVAL_MS,
    ITEMS_PER_PAGE,
    DLC_ITEMS_PER_PAGE,
    COMMAND_OUTPUT_MAX_CHARS,
    DLC_CACHE_MAX_SIZE,
    SINGLE_CACHE_MAX_SIZE,
    DEALS_CURRENCY_CACHE_MAX_SIZE,
    DEALS_HISTORY_LIMIT,
    SEEN_PER_GAME_LIMIT,
    PENDING_UPDATES_PER_GAME_LIMIT,
    PENDING_DISCOUNTS_LIMIT,
    PENDING_UPDATE_MAX_AGE_MS,
    PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_DISCOUNT_MAX_ATTEMPTS,
    MAX_UPDATES_PER_CYCLE,
    MAX_DEALS_PER_CYCLE,
    DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY,
    MAX_FUZZY_SEARCH_INPUT,
    USER_COMMAND_COOLDOWN_MS,
    COLLECTOR_TIMEOUT_MS,
    COLORS,
    OP_UPDATE_OPTS,
    setGlobalCacheTtl,
    normalizeCurrencyKey,
    cache,
    getUpdatesCacheData,
    setUpdatesCache,
    getDealsCacheData,
    setDealsCache,
    cacheGetLRU,
    evictLRU,
    cacheSetLRU,
    checkUserCooldown,
    cleanUserCooldowns,
    cleanCache,
    getCacheSizes,
    startCacheCleaner,
    smoothTime,
    formatUserError,
    canSendEmbeds,
    missingChannelPermsMessage,
    makeActivationId,
    sleepIfPositive
  });
}

export = attachCommandCache;
