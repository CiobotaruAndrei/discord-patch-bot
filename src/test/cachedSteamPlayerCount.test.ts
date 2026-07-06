import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/player-count/cachedSteamPlayerCount") as typeof import("../features/player-count/cachedSteamPlayerCount");
const cacheMod = require("../infra/redis/redisCache") as typeof import("../infra/redis/redisCache");
import type { RedisCacheClient } from "../infra/redis/redisCache";
import type { LoggerFunction } from "../types";

type SteamPlayers = { appId: string; playerCount: number; success: boolean };

function makeFakeCache() {
  const store = new Map<string, unknown>();
  const calls = { getJson: 0, setJson: 0, lastSet: null as { key: string; value: unknown; ttl: number } | null };
  const cache = {
    getJson: async <T>(key: string): Promise<T | null> => { calls.getJson++; return store.has(key) ? (store.get(key) as T) : null; },
    setJson: async (key: string, value: unknown, ttlSeconds: number): Promise<void> => { calls.setJson++; calls.lastSet = { key, value, ttl: ttlSeconds }; store.set(key, value); }
  };
  return { cache, store, calls };
}

const noopLogger: LoggerFunction = () => undefined;

test("cachedSteamPlayerCount: cache HIT -> intoarce valoarea din cache, fara fetch", async () => {
  const { cache, store } = makeFakeCache();
  store.set("player-count:steam:730", { appId: "730", playerCount: 999, success: true });
  let fetchCalls = 0;
  const cached = mod.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: async appId => { fetchCalls++; return { appId: String(appId), playerCount: 1, success: true }; },
    cache,
    ttlSeconds: 60
  });
  assert.deepEqual(await cached("730"), { appId: "730", playerCount: 999, success: true });
  assert.equal(fetchCalls, 0, "cache hit -> nu se atinge Steam");
});

test("cachedSteamPlayerCount: cache MISS -> fetch, apoi cache-uieste cu cheia si TTL corecte", async () => {
  const { cache, calls } = makeFakeCache();
  let fetchCalls = 0;
  const cached = mod.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: async appId => { fetchCalls++; return { appId: String(appId), playerCount: 42, success: true }; },
    cache,
    ttlSeconds: 60
  });
  assert.deepEqual(await cached(730), { appId: "730", playerCount: 42, success: true });
  assert.equal(fetchCalls, 1, "miss -> un fetch");
  assert.deepEqual(calls.lastSet, {
    key: "player-count:steam:730",
    value: { appId: "730", playerCount: 42, success: true },
    ttl: 60
  }, "rezultatul e cache-uit cu cheia player-count:steam:<appId> si TTL 60");
});

test("cachedSteamPlayerCount: un fetch ESUAT nu se cache-uieste (ca sa nu inghete o eroare 60s)", async () => {
  const { cache, calls } = makeFakeCache();
  const cached = mod.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: async appId => ({ appId: String(appId), playerCount: 0, success: false }),
    cache,
    ttlSeconds: 60
  });
  const result: SteamPlayers = await cached(730);
  assert.equal(result.success, false);
  assert.equal(calls.setJson, 0, "rezultat cu success=false -> nu se scrie in cache");
});

test("cachedSteamPlayerCount: Redis DEZACTIVAT -> fallback la comportamentul actual (fiecare apel face fetch)", async () => {
  const disabledCache = cacheMod.createRedisCache({ runtime: { enabled: false, getClient: () => null }, logger: noopLogger });
  let fetchCalls = 0;
  const cached = mod.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: async appId => { fetchCalls++; return { appId: String(appId), playerCount: 5, success: true }; },
    cache: disabledCache,
    ttlSeconds: 60
  });
  assert.deepEqual(await cached(1), { appId: "1", playerCount: 5, success: true });
  assert.deepEqual(await cached(1), { appId: "1", playerCount: 5, success: true });
  assert.equal(fetchCalls, 2, "Redis dezactivat -> fara caching, comportamentul actual e pastrat");
});

test("cachedSteamPlayerCount: Redis EROARE -> fallback fara throw, rezultatul comenzii neschimbat", async () => {
  const throwingClient: RedisCacheClient = {
    get: async () => { throw new Error("redis get boom"); },
    set: async () => { throw new Error("redis set boom"); },
    del: async () => { throw new Error("redis del boom"); }
  };
  const errorCache = cacheMod.createRedisCache({ runtime: { enabled: true, getClient: () => throwingClient }, logger: noopLogger });
  let fetchCalls = 0;
  const cached = mod.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: async appId => { fetchCalls++; return { appId: String(appId), playerCount: 7, success: true }; },
    cache: errorCache,
    ttlSeconds: 60
  });
  assert.deepEqual(await cached(2), { appId: "2", playerCount: 7, success: true }, "eroarea de Redis nu schimba rezultatul");
  assert.equal(fetchCalls, 1, "la eroare de Redis se face fetch normal");
});
