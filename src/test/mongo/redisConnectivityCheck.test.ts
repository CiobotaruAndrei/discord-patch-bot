import test from "node:test";
import assert from "node:assert/strict";

import * as mod from "../../infra/redis/redisConnectivityCheck.js";
import type { RedisConnectivityRuntime } from "../../infra/redis/redisConnectivityCheck.js";

function makeRuntime(opts: {
  enabled: boolean;
  connect?: () => Promise<void>;
  ping?: () => Promise<unknown>;
  client?: { ping(): Promise<unknown> } | null;
}) {
  const calls = { connect: 0, close: 0, ping: 0 };
  const client = opts.client === undefined
    ? { ping: async () => { calls.ping++; return (opts.ping ? opts.ping() : "PONG"); } }
    : opts.client;
  const runtime: RedisConnectivityRuntime = {
    enabled: opts.enabled,
    getClient: () => client,
    connect: async () => { calls.connect++; if (opts.connect) await opts.connect(); },
    close: async () => { calls.close++; }
  };
  return { runtime, calls };
}

test("runRedisConnectivityCheck: REDIS_URL lipsa -> disabled, ok=true, fara connect", async () => {
  const { runtime, calls } = makeRuntime({ enabled: false });
  const result = await mod.runRedisConnectivityCheck(runtime);
  assert.equal(result.status, "disabled");
  assert.equal(result.ok, true);
  assert.match(result.message, /dezactivat/);
  assert.equal(calls.connect, 0, "fara REDIS_URL nu se conecteaza");
  assert.equal(calls.close, 0, "nimic de inchis cand e dezactivat");
});

test("runRedisConnectivityCheck: conexiune + PING reusit -> ok, si inchide conexiunea", async () => {
  const { runtime, calls } = makeRuntime({ enabled: true });
  const result = await mod.runRedisConnectivityCheck(runtime);
  assert.equal(result.status, "ok");
  assert.equal(result.ok, true);
  assert.match(result.message, /PING -> PONG/);
  assert.equal(calls.connect, 1);
  assert.equal(calls.ping, 1);
  assert.equal(calls.close, 1, "conexiunea se inchide dupa verificare");
});

test("runRedisConnectivityCheck: connect esueaza -> failed, ok=false, tot inchide", async () => {
  const { runtime, calls } = makeRuntime({ enabled: true, connect: async () => { throw new Error("ECONNREFUSED"); } });
  const result = await mod.runRedisConnectivityCheck(runtime);
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.match(result.message, /ECONNREFUSED/);
  assert.equal(calls.close, 1, "close ruleaza in finally chiar si la esec");
});

test("runRedisConnectivityCheck: PING esueaza -> failed, ok=false", async () => {
  const { runtime } = makeRuntime({ enabled: true, ping: async () => { throw new Error("timeout la PING"); } });
  const result = await mod.runRedisConnectivityCheck(runtime);
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.match(result.message, /timeout la PING/);
});

test("runRedisConnectivityCheck: client indisponibil dupa connect -> failed", async () => {
  const { runtime } = makeRuntime({ enabled: true, client: null });
  const result = await mod.runRedisConnectivityCheck(runtime);
  assert.equal(result.status, "failed");
  assert.equal(result.ok, false);
  assert.match(result.message, /indisponibil/);
});
