import type { LoggerFunction } from "../../types";

const { errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");

interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface RedisCacheRuntime {
  readonly enabled: boolean;
  getClient(): RedisCacheClient | null;
}

interface RedisCache {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  deleteKey(key: string): Promise<void>;
}

interface RedisCacheDeps {
  runtime: RedisCacheRuntime;
  logger: LoggerFunction;
}

function createRedisCache({ runtime, logger }: RedisCacheDeps): RedisCache {
  function activeClient(): RedisCacheClient | null {
    if (!runtime.enabled) return null;
    return runtime.getClient();
  }

  async function getJson<T>(key: string): Promise<T | null> {
    const client = activeClient();
    if (!client) return null;
    try {
      const raw = await client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger("WARN", "REDIS_CACHE", `getJson(${key}) a esuat — cad pe fallback`, errorMessage(err));
      return null;
    }
  }

  async function setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = activeClient();
    if (!client) return;
    try {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err) {
      logger("WARN", "REDIS_CACHE", `setJson(${key}) a esuat — ignor (cache best-effort)`, errorMessage(err));
    }
  }

  async function deleteKey(key: string): Promise<void> {
    const client = activeClient();
    if (!client) return;
    try {
      await client.del(key);
    } catch (err) {
      logger("WARN", "REDIS_CACHE", `deleteKey(${key}) a esuat — ignor (cache best-effort)`, errorMessage(err));
    }
  }

  return { getJson, setJson, deleteKey };
}

export { createRedisCache };
export type { RedisCache, RedisCacheClient, RedisCacheRuntime, RedisCacheDeps };
