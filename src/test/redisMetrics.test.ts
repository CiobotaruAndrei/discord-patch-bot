import test from "node:test";
import assert from "node:assert/strict";

const redisMetrics = require("../infra/redis/redisMetrics") as typeof import("../infra/redis/redisMetrics");
const cacheMod = require("../infra/redis/redisCache") as typeof import("../infra/redis/redisCache");
const clientMod = require("../infra/redis/redisClient") as typeof import("../infra/redis/redisClient");
import type { RedisCacheClient, RedisCacheRuntime } from "../infra/redis/redisCache";
import type { RedisClientLike } from "../infra/redis/redisClient";
import type { LoggerFunction } from "../types";

const noop: LoggerFunction = () => undefined;

function freshCounters() {
  return { redisConnectSuccess: 0, redisConnectFailure: 0, redisCacheHit: 0, redisCacheMiss: 0, redisErrors: 0 };
}

function makeRedisClient(opts: { connectOk: boolean }) {
  let open = false;
  let errorListener: ((err: unknown) => void) | null = null;
  const client: RedisClientLike = {
    on(event, listener) { if (event === "error") errorListener = listener; return client; },
    connect: async () => { if (!opts.connectOk) throw new Error("ECONNREFUSED"); open = true; return client; },
    quit: async () => { open = false; return "OK"; },
    ping: async () => "PONG",
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    get isOpen() { return open; }
  };
  return { client, fireError: (err: unknown) => { if (errorListener) errorListener(err); } };
}

test("redisMetrics: record* incrementeaza contoarele atasate", () => {
  const counters = freshCounters();
  redisMetrics.attachRedisMetrics(counters);
  redisMetrics.recordRedisConnectSuccess();
  redisMetrics.recordRedisConnectFailure();
  redisMetrics.recordRedisCacheHit();
  redisMetrics.recordRedisCacheHit();
  redisMetrics.recordRedisCacheMiss();
  redisMetrics.recordRedisError();
  assert.deepEqual(counters, { redisConnectSuccess: 1, redisConnectFailure: 1, redisCacheHit: 2, redisCacheMiss: 1, redisErrors: 1 });
  redisMetrics.attachRedisMetrics(null);
});

test("redisMetrics: fara atasare (detached) record* sunt no-op, nu arunca", () => {
  redisMetrics.attachRedisMetrics(null);
  assert.doesNotThrow(() => {
    redisMetrics.recordRedisCacheHit();
    redisMetrics.recordRedisConnectFailure();
    redisMetrics.recordRedisError();
  });
});

test("redisMetrics: redisCache.getJson incrementeaza hit / miss / errors prin ref", async () => {
  const counters = freshCounters();
  redisMetrics.attachRedisMetrics(counters);
  const store = new Map<string, string>();
  store.set("k-hit", JSON.stringify({ v: 1 }));
  const client: RedisCacheClient = {
    get: async key => {
      if (key === "k-throw") throw new Error("get boom");
      return store.has(key) ? store.get(key)! : null;
    },
    set: async () => "OK",
    del: async () => 0
  };
  const runtime: RedisCacheRuntime = { enabled: true, getClient: () => client };
  const cache = cacheMod.createRedisCache({ runtime, logger: noop });

  await cache.getJson("k-hit");
  await cache.getJson("k-miss");
  await cache.getJson("k-throw");

  assert.equal(counters.redisCacheHit, 1, "cheie prezenta -> hit");
  assert.equal(counters.redisCacheMiss, 1, "cheie absenta -> miss");
  assert.equal(counters.redisErrors, 1, "eroare de get -> redisErrors");
  redisMetrics.attachRedisMetrics(null);
});

test("redisMetrics: Redis dezactivat -> metrici raman 0 (cache si connect)", async () => {
  const counters = freshCounters();
  redisMetrics.attachRedisMetrics(counters);

  const cache = cacheMod.createRedisCache({ runtime: { enabled: false, getClient: () => null }, logger: noop });
  await cache.getJson("x");
  await cache.setJson("x", { a: 1 }, 60);

  await clientMod.createRedisRuntime({}, noop).connect();

  assert.deepEqual(counters, freshCounters(), "fara Redis nu se misca niciun contor");
  redisMetrics.attachRedisMetrics(null);
});

test("redisMetrics: connect() incrementeaza success/failure, iar evenimentul 'error' incrementeaza errors", async () => {
  const counters = freshCounters();
  redisMetrics.attachRedisMetrics(counters);

  const ok = makeRedisClient({ connectOk: true });
  await clientMod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, noop, () => ok.client).connect();
  assert.equal(counters.redisConnectSuccess, 1, "connect reusit -> redisConnectSuccess");

  const bad = makeRedisClient({ connectOk: false });
  await assert.rejects(clientMod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, noop, () => bad.client).connect());
  assert.equal(counters.redisConnectFailure, 1, "connect esuat -> redisConnectFailure (si tot arunca, boot fail-fast)");

  ok.fireError(new Error("boom"));
  assert.equal(counters.redisErrors, 1, "evenimentul error al clientului -> redisErrors");
  redisMetrics.attachRedisMetrics(null);
});
