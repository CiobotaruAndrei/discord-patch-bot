import type { LoggerFunction } from "../../types.js";

import { errorMessage } from "../../shared/errors.js";
import redisMetrics from "./redisMetrics.js";

interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface RedisCacheRuntime {
  readonly enabled: boolean;
  getClient(): RedisCacheClient | null;
  status?(): "disabled" | "connected" | "disconnected";
}

interface RedisCache {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  deleteKey(key: string): Promise<void>;
  status(): "disabled" | "connected" | "disconnected";
  getGeneration(key: string): Promise<number>;
  bumpGeneration(key: string): Promise<number>;
  setVersionedJson(key: string, value: unknown, ttlSeconds: number): Promise<number>;
  getVersionedJson<T>(key: string, generationKey: string, ttlSeconds?: number): Promise<T | null>;
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
      if (raw === null) {
        redisMetrics.recordRedisCacheMiss();
        return null;
      }
      redisMetrics.recordRedisCacheHit();
      return JSON.parse(raw) as T;
    } catch (err) {
      redisMetrics.recordRedisError();
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
      redisMetrics.recordRedisError();
      logger("WARN", "REDIS_CACHE", `setJson(${key}) a esuat — ignor (cache best-effort)`, errorMessage(err));
    }
  }

  async function deleteKey(key: string): Promise<void> {
    const client = activeClient();
    if (!client) return;
    try {
      await client.del(key);
    } catch (err) {
      redisMetrics.recordRedisError();
      logger("WARN", "REDIS_CACHE", `deleteKey(${key}) a esuat — ignor (cache best-effort)`, errorMessage(err));
    }
  }

  async function getGeneration(key: string): Promise<number> {
    const value = await getJson<number>(key);
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  async function bumpGeneration(key: string): Promise<number> {
    const next = (await getGeneration(key)) + 1;
    await setJson(key, next, 24 * 60 * 60);
    return next;
  }

  async function setVersionedJson(key: string, value: unknown, ttlSeconds: number): Promise<number> {
    const generation = await bumpGeneration(`${key}:generation`);
    await setJson(key, { generation, payload: value }, ttlSeconds);
    return generation;
  }

  async function getVersionedJson<T>(key: string, generationKey: string, ttlSeconds?: number): Promise<T | null> {
    const envelope = await getJson<{ generation?: number; payload?: T }>(key);
    if (!envelope || typeof envelope.generation !== "number") return null;
    const current = await getGeneration(generationKey);
    if (envelope.generation !== current) {
      await deleteKey(key);
      return null;
    }
    return envelope.payload ?? null;
  }

  return { getJson, setJson, deleteKey, status: () => runtime.status?.() ?? (runtime.enabled ? "disconnected" : "disabled"), getGeneration, bumpGeneration, setVersionedJson, getVersionedJson };
}

export { createRedisCache };
export type { RedisCache, RedisCacheClient, RedisCacheRuntime, RedisCacheDeps };
