"use strict";

import type { DealInfo, DlcCacheEntry, FetchResult, NormalizedUpdate } from "../../sources/sourceTypes.js";

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
