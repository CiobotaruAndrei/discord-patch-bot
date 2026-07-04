import type {
  CacheEntry,
  CommandCacheSizes,
  CommandRuntimeCache,
  DealInfo,
  DlcCacheEntry,
  FetchResult,
  NormalizedUpdate
} from "../../types";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export function cacheGetLRU<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
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

export function evictLRU<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size <= maxSize) return;
  const toDelete = map.size - maxSize;
  let deleted = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++deleted >= toDelete) break;
  }
}

export function cacheSetLRU<T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number, maxSize: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, { data, expiresAt: Date.now() + ttlMs });
  evictLRU(map, maxSize);
}

export interface CommandCachesDeps {
  logger: Logger;
  DEFAULT_CURRENCY: string;
  DEALS_CURRENCY_CACHE_MAX_SIZE: number;
  SINGLE_CACHE_MAX_SIZE: number;
  DLC_CACHE_MAX_SIZE: number;
  cleanUserCooldowns(): void;
  getUserCooldownsSize(): number;
}

export function createCommandCaches(deps: CommandCachesDeps) {
  const {
    logger, DEFAULT_CURRENCY,
    DEALS_CURRENCY_CACHE_MAX_SIZE, SINGLE_CACHE_MAX_SIZE, DLC_CACHE_MAX_SIZE,
    cleanUserCooldowns, getUserCooldownsSize
  } = deps;

  let GLOBAL_CACHE_TTL_MS = 1800000;
  function setGlobalCacheTtl(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) {
      GLOBAL_CACHE_TTL_MS = Math.min(ms, 30 * 60 * 1000);
      logger("INFO", "CACHE", `GLOBAL_CACHE_TTL_MS setat la ${GLOBAL_CACHE_TTL_MS}ms`);
    }
  }

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
      userCooldowns: getUserCooldownsSize()
    };
  }

  return {
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
    cleanCache,
    getCacheSizes
  };
}
