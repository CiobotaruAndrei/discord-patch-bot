import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../infra/redis/redisCache") as typeof import("../infra/redis/redisCache");
import type { RedisCacheClient, RedisCacheRuntime } from "../infra/redis/redisCache";
import type { LoggerFunction } from "../types";

function makeStoreClient() {
  const store = new Map<string, string>();
  const calls = { get: 0, set: 0, del: 0, lastSetOptions: null as { EX?: number } | null };
  const client: RedisCacheClient = {
    get: async key => { calls.get++; return store.has(key) ? store.get(key)! : null; },
    set: async (key, value, options) => { calls.set++; calls.lastSetOptions = options ?? null; store.set(key, value); return "OK"; },
    del: async key => { calls.del++; const had = store.delete(key); return had ? 1 : 0; }
  };
  return { client, store, calls };
}

function makeThrowingClient(): RedisCacheClient {
  return {
    get: async () => { throw new Error("get boom"); },
    set: async () => { throw new Error("set boom"); },
    del: async () => { throw new Error("del boom"); }
  };
}

function runtimeFrom(enabled: boolean, client: RedisCacheClient | null): RedisCacheRuntime {
  return { enabled, getClient: () => client };
}

function collectWarns() {
  const warns: string[] = [];
  const logger: LoggerFunction = (level, context, message) => { if (level === "WARN" && context === "REDIS_CACHE") warns.push(message); };
  return { warns, logger };
}

test("redisCache: Redis dezactivat -> getJson null, setJson/deleteKey no-op fara a atinge clientul", async () => {
  const { client, calls } = makeStoreClient();
  const { logger } = collectWarns();
  const cache = mod.createRedisCache({ runtime: runtimeFrom(false, client), logger });

  assert.equal(await cache.getJson("k"), null, "dezactivat -> null (cache miss)");
  await cache.setJson("k", { a: 1 }, 60);
  await cache.deleteKey("k");
  assert.deepEqual(calls, { get: 0, set: 0, del: 0, lastSetOptions: null }, "dezactivat -> clientul nu e atins deloc");
});

test("redisCache: round-trip getJson/setJson/deleteKey cand Redis e activ, cu TTL transmis", async () => {
  const { client, store, calls } = makeStoreClient();
  const { logger } = collectWarns();
  const cache = mod.createRedisCache({ runtime: runtimeFrom(true, client), logger });

  assert.equal(await cache.getJson("missing"), null, "cheie absenta -> null");

  await cache.setJson("user:1", { name: "ana", n: 3 }, 45);
  assert.deepEqual(calls.lastSetOptions, { EX: 45 }, "TTL-ul e transmis prin optiunea EX");
  assert.equal(store.get("user:1"), JSON.stringify({ name: "ana", n: 3 }), "valoarea e serializata JSON");

  assert.deepEqual(await cache.getJson<{ name: string; n: number }>("user:1"), { name: "ana", n: 3 }, "getJson deserializeaza");

  await cache.deleteKey("user:1");
  assert.equal(store.has("user:1"), false, "deleteKey sterge cheia");
  assert.equal(await cache.getJson("user:1"), null, "dupa delete -> null");
});

test("redisCache: getJson pe JSON corupt -> null + WARN, nu arunca", async () => {
  const { client, store } = makeStoreClient();
  store.set("bad", "{nu-e-json");
  const { warns, logger } = collectWarns();
  const cache = mod.createRedisCache({ runtime: runtimeFrom(true, client), logger });

  assert.equal(await cache.getJson("bad"), null, "JSON corupt -> null (fallback)");
  assert.equal(warns.length, 1, "un WARN pentru parse esuat");
});

test("redisCache: erori de client -> fallback fara throw (getJson null, set/del ignorate) + WARN", async () => {
  const { warns, logger } = collectWarns();
  const cache = mod.createRedisCache({ runtime: runtimeFrom(true, makeThrowingClient()), logger });

  assert.equal(await cache.getJson("k"), null, "get arunca -> null, nu propaga");
  await assert.doesNotReject(cache.setJson("k", { a: 1 }, 30), "set arunca -> nu propaga");
  await assert.doesNotReject(cache.deleteKey("k"), "del arunca -> nu propaga");
  assert.equal(warns.length, 3, "cate un WARN pentru get/set/del esuate");
});
