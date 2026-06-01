import test from "node:test";
import assert from "node:assert/strict";
import { createAppRuntime } from "../app/appRuntime";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";

function makeDeps(overrides: { updatesFetchedAt?: Date } = {}) {
  const order: string[] = [];
  const updatesCache: unknown[] = [];
  const dealsCache: Array<[string, unknown]> = [];
  const shutdownCalls: Array<{ signal: string; code?: number }> = [];
  const registered = { count: 0 };
  let eventsOpts: Record<string, unknown> = {};

  class FakeClient {
    login = async () => { order.push("login"); return "ok"; };
  }

  const deps = {
    mongoose: { connect: async () => { order.push("connect"); }, connection: { readyState: 1 } },
    crypto: {},
    performance: { now: () => 0 },
    Client: FakeClient,
    GatewayIntentBits: { Guilds: 1 },
    loadConfig: () => ({ config: {}, games: [] }),
    createMetrics: () => ({ startedAt: Date.now() }),
    createRateLimiter: () => ({ size: 0 }),
    createHousekeeping: () => ({ start: () => order.push("housekeeping"), stop: () => undefined }),
    createCronController: () => ({
      scheduleNextCron: () => order.push("cron"),
      runCronCycle: async () => undefined,
      stop: () => undefined,
      getHealthSnapshot: () => ({})
    }),
    createOutboxWorker: () => ({ start: () => undefined, stop: () => undefined }),
    createHttpServer: () => ({
      on: () => undefined,
      listen: (_port: number, cb?: () => void) => { order.push("listen"); if (cb) cb(); },
      close: () => undefined
    }),
    registerDiscordEvents: (opts: Record<string, unknown>) => { eventsOpts = opts; },
    registerMongoEvents: () => undefined,
    createShutdownController: () => ({
      shutdown: async (signal: string, code?: number) => { shutdownCalls.push({ signal, code }); },
      registerProcessHandlers: () => { registered.count++; }
    }),
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    mongo: {
      logger: () => undefined,
      env: { MONGO_URI: "mongodb://x", MONGO_MAX_POOL_SIZE: 5, PORT: 3000, DISCORD_TOKEN: "t" },
      parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "tok",
      renewDbLock: async () => true,
      releaseDbLock: async () => undefined,
      activeLocks: { size: 0 },
      waitForMongoReady: async () => { order.push("ready"); return true; },
      cleanGuildCache: () => undefined,
      getGuildCacheSize: () => 0,
      adminAlert: async () => undefined,
      runMigrations: async () => { order.push("migrate"); return { applied: [1, 2] }; },
      requestContext: {},
      loadFetchSnapshot: async (_id: string) => { order.push("loadUpdates"); return { payload: [{ x: 1 }], fetchedAt: overrides.updatesFetchedAt ?? new Date() }; },
      loadDealsFetchSnapshots: async () => { order.push("loadDeals"); return [{ currency: "USD", payload: [{ d: 1 }], fetchedAt: new Date() }]; }
    },
    commands: {
      drainOutbox: async () => ({}),
      setUpdatesCache: (payload: unknown) => { updatesCache.push(payload); },
      setDealsCache: (currency: string, payload: unknown) => { dealsCache.push([currency, payload]); }
    },
    scrapers: { attachMetrics: () => undefined }
  };
  return { deps, order, updatesCache, dealsCache, shutdownCalls, registered, getEventsOpts: () => eventsOpts };
}

test("createAppRuntime: start() ruleaza secventa de boot in ordine (connect -> migrate -> hydrate -> listen -> login)", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps as unknown as Parameters<typeof createAppRuntime>[0]);
  await app.start();
  assert.deepEqual(
    h.order,
    ["connect", "ready", "migrate", "loadUpdates", "loadDeals", "listen", "login"],
    "boot-ul respecta ordinea connect -> ready -> migrate -> hydrate -> listen -> login"
  );
});

test("createAppRuntime: hidrateaza cache-urile din snapshot-uri proaspete", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps as unknown as Parameters<typeof createAppRuntime>[0]);
  await app.start();
  assert.equal(h.updatesCache.length, 1, "snapshot updates proaspat -> setUpdatesCache");
  assert.deepEqual(h.dealsCache, [["USD", [{ d: 1 }]]], "snapshot deals proaspat -> setDealsCache");
});

test("createAppRuntime: snapshot updates invechit (>30min) NU hidrateaza cache-ul", async () => {
  const h = makeDeps({ updatesFetchedAt: new Date(Date.now() - 31 * 60 * 1000) });
  const app = createAppRuntime(h.deps as unknown as Parameters<typeof createAppRuntime>[0]);
  await app.start();
  assert.equal(h.updatesCache.length, 0, "snapshot vechi -> fara setUpdatesCache");
});

test("createAppRuntime: registerProcessHandlers si stop deleaga catre shutdown controller", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps as unknown as Parameters<typeof createAppRuntime>[0]);
  app.registerProcessHandlers();
  assert.equal(h.registered.count, 1, "registerProcessHandlers deleaga o data");
  await app.stop("SIGTERM", 0);
  assert.deepEqual(h.shutdownCalls, [{ signal: "SIGTERM", code: 0 }], "stop deleaga catre shutdown.shutdown");
});

test("createAppRuntime: cableaza event-urile Discord (cron + housekeeping)", () => {
  const h = makeDeps();
  createAppRuntime(h.deps as unknown as Parameters<typeof createAppRuntime>[0]);
  const opts = h.getEventsOpts();
  assert.equal(typeof opts.scheduleNextCron, "function", "scheduleNextCron este cablat in event-uri");
  assert.equal(typeof opts.startHousekeeping, "function", "startHousekeeping este cablat in event-uri");
});
