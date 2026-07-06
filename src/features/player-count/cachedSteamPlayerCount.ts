import type { RedisCache } from "../../infra/redis/redisCache";

interface SteamCurrentPlayers {
  appId: string;
  playerCount: number;
  success: boolean;
}

type FetchSteamCurrentPlayers = (appId: string | number) => Promise<SteamCurrentPlayers>;

interface CachedSteamPlayerCountDeps {
  fetchSteamCurrentPlayers: FetchSteamCurrentPlayers;
  cache: Pick<RedisCache, "getJson" | "setJson">;
  ttlSeconds: number;
}

function playerCountCacheKey(appId: string | number): string {
  return `player-count:steam:${appId}`;
}

function createCachedSteamPlayerCount(deps: CachedSteamPlayerCountDeps): FetchSteamCurrentPlayers {
  const { fetchSteamCurrentPlayers, cache, ttlSeconds } = deps;

  return async function fetchSteamCurrentPlayersCached(appId: string | number): Promise<SteamCurrentPlayers> {
    const key = playerCountCacheKey(appId);
    const cached = await cache.getJson<SteamCurrentPlayers>(key);
    if (cached && cached.success) return cached;
    const fresh = await fetchSteamCurrentPlayers(appId);
    if (fresh.success) await cache.setJson(key, fresh, ttlSeconds);
    return fresh;
  };
}

export = { createCachedSteamPlayerCount, playerCountCacheKey };
