import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../infra/redis/redisClient") as typeof import("../infra/redis/redisClient");
import type { RedisClientLike, RedisClientFactory } from "../infra/redis/redisClient";
import type { LoggerFunction } from "../types";

function makeFakeClient(opts: { isOpen?: boolean } = {}) {
  const calls = { connect: 0, quit: 0, errorListeners: [] as Array<(err: unknown) => void> };
  let open = opts.isOpen ?? false;
  const client: RedisClientLike = {
    on(event, listener) { if (event === "error") calls.errorListeners.push(listener); return client; },
    connect: async () => { calls.connect++; open = true; return client; },
    quit: async () => { calls.quit++; open = false; return "OK"; },
    get isOpen() { return open; }
  };
  return { client, calls };
}

test("createRedisRuntime: fara REDIS_URL -> dezactivat, connect/close no-op fara a crea client", async () => {
  const logs: Array<{ level: string; context: string; message: string }> = [];
  const logger: LoggerFunction = (level, context, message) => { logs.push({ level: String(level), context, message }); };
  let factoryCalled = false;
  const factory: RedisClientFactory = () => { factoryCalled = true; throw new Error("nu trebuie apelat"); };

  const runtime = mod.createRedisRuntime({}, logger, factory);

  assert.equal(runtime.enabled, false, "fara REDIS_URL Redis e dezactivat");
  assert.equal(runtime.getClient(), null, "niciun client cand e dezactivat");
  assert.equal(factoryCalled, false, "fara REDIS_URL nu se instantiaza clientul");
  await runtime.connect();
  await runtime.close();
  assert.ok(
    logs.some(l => l.level === "INFO" && l.context === "REDIS" && /dezactivat/.test(l.message)),
    "connect() logheaza informativ ca Redis e dezactivat"
  );
});

test("createRedisRuntime: cu REDIS_URL creeaza clientul din URL-ul de env si connect() il conecteaza", async () => {
  const seenOptions: Array<{ url: string }> = [];
  const { client, calls } = makeFakeClient();
  const factory: RedisClientFactory = options => { seenOptions.push(options); return client; };
  const messages: string[] = [];
  const logger: LoggerFunction = (_level, _context, message) => { messages.push(message); };

  const runtime = mod.createRedisRuntime({ REDIS_URL: "redis://user:pass@host:6380" }, logger, factory);

  assert.equal(runtime.enabled, true, "cu REDIS_URL Redis e activat");
  assert.deepEqual(seenOptions, [{ url: "redis://user:pass@host:6380" }], "clientul primeste exact URL-ul din env");
  assert.equal(runtime.getClient(), client, "getClient() expune clientul creat");
  await runtime.connect();
  assert.equal(calls.connect, 1, "connect() cheama client.connect() o data");
  assert.ok(messages.some(m => /Redis conectat/.test(m)), "connect() logheaza 'Redis conectat'");
});

test("createRedisRuntime: close() cheama quit() doar cand clientul e deschis", async () => {
  const logger: LoggerFunction = () => undefined;
  const factoryFor = (client: RedisClientLike): RedisClientFactory => () => client;

  const closed = makeFakeClient({ isOpen: false });
  await mod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, logger, factoryFor(closed.client)).close();
  assert.equal(closed.calls.quit, 0, "client inchis -> quit() nu e apelat");

  const open = makeFakeClient({ isOpen: true });
  await mod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, logger, factoryFor(open.client)).close();
  assert.equal(open.calls.quit, 1, "client deschis -> quit() apelat o data");
});

test("createRedisRuntime: status() -> disabled fara URL, connected cand clientul e deschis, disconnected cand e inchis", () => {
  const logger: LoggerFunction = () => undefined;

  assert.equal(mod.createRedisRuntime({}, logger, () => { throw new Error("nu se apeleaza"); }).status(), "disabled");

  const open = makeFakeClient({ isOpen: true });
  assert.equal(mod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, logger, () => open.client).status(), "connected");

  const closed = makeFakeClient({ isOpen: false });
  assert.equal(mod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, logger, () => closed.client).status(), "disconnected");
});

test("createRedisRuntime: evenimentul 'error' al clientului e logat ca ERROR", () => {
  const { client, calls } = makeFakeClient();
  const factory: RedisClientFactory = () => client;
  const errors: string[] = [];
  const logger: LoggerFunction = (level, context, message) => { if (level === "ERROR" && context === "REDIS") errors.push(message); };

  mod.createRedisRuntime({ REDIS_URL: "redis://h:6379" }, logger, factory);

  assert.equal(calls.errorListeners.length, 1, "un singur listener pe evenimentul 'error'");
  calls.errorListeners[0](new Error("boom"));
  assert.equal(errors.length, 1, "eroarea de client e logata ca ERROR in contextul REDIS");
});
