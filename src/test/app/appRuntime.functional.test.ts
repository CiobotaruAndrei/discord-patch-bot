import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import { createGameCatalog } from "../../config/gameCatalog.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GatewayIntentBits } from "discord.js";
import { createAppRuntime, connectMongoWithRetry, hydrateStartupCaches } from "../../app/appRuntime.js";
import type { AppRuntimeDeps } from "../../app/appRuntime.js";
import type { RuntimeEnv } from "../../types.js";
import type { CreateOutboxWorkerDeps } from "../../app/scheduler/outboxWorker.js";
import type { RegisterDiscordEventsDeps } from "../../app/lifecycle/events.js";
import { createMetrics } from "../../app/health/metrics.js";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";

function makeDeps(overrides: { updatesFetchedAt?: Date } = {}) {
  const order: string[] = [];
  const updatesCache: unknown[] = [];
  const dealsCache: Array<[string, unknown]> = [];
  const shutdownCalls: Array<{ signal: string; code?: number }> = [];
  const registered = { count: 0 };
  let eventsOpts: RegisterDiscordEventsDeps | undefined;
  let outboxWorkerOpts: CreateOutboxWorkerDeps | undefined;
  let getOutboxPausedCalls = 0;
  const pausedValue = false;

  class FakeClient {
    user = null;
    channels = { fetch: async () => null };
    login = async () => { order.push("login"); return "ok"; };
    destroy = () => undefined;
    isReady = () => true;
    once = () => undefined;
    on = () => undefined;
  }

  const deps: AppRuntimeDeps = {
    mongoose: {
      connect: async () => { order.push("connect"); },
      connection: { readyState: 1, close: async () => undefined, on: () => undefined }
    },
    crypto: { randomBytes: (size: number) => Buffer.alloc(size), timingSafeEqual: () => true },
    performance: { now: () => 0 },
    Client: FakeClient,
    GatewayIntentBits,
    loadConfig: () => ({ config: { games: [] }, games: [], catalog: createGameCatalog([]), configPath: "test-config.json" }),
    createMetrics,
    createRateLimiter: () => ({ check: () => true, prune: () => undefined, size: 0, retryAfterSeconds: 1 }),
    createHousekeeping: () => ({ start: () => order.push("housekeeping"), stop: async () => undefined }),
    createCronController: () => ({
      scheduleNextCron: () => order.push("cron"),
      runCronCycle: async () => undefined,
      stop: () => undefined,
      shouldAbortCron: () => false,
      getHealthSnapshot: () => ({ successRatio: null, windowSize: 0, healthSkipScheduled: false })
    }),
    createOutboxWorker: (opts) => { outboxWorkerOpts = opts; return { start: () => undefined, stop: () => undefined, drainTick: async () => undefined }; },
    createHttpServer: () => ({
      on: () => undefined,
      listen: (_port: number | string, cb?: () => void) => { order.push("listen"); if (cb) cb(); },
      close: () => undefined
    }),
    registerDiscordEvents: (opts) => { eventsOpts = opts; },
    registerMongoEvents: () => undefined,
    createShutdownController: () => ({
      shutdown: async (signal: string, code?: number) => { shutdownCalls.push({ signal, code }); },
      handleFatalProcessError: () => undefined,
      registerProcessHandlers: () => { registered.count++; }
    }),
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    redis: {
      enabled: false,
      getClient: () => null,
      status: () => "disabled",
      connect: async () => { order.push("redis.connect"); },
      close: async () => { order.push("redis.close"); }
    },
    mongo: {
      guildSettingsBus: createGuildSettingsEventBus(),
      logger: () => undefined,
      env: { MONGO_URI: "mongodb://x", MONGO_MAX_POOL_SIZE: 5, PORT: "3000", DISCORD_TOKEN: "t" } as RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string },
      parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "tok",
      renewDbLock: async () => true,
      releaseDbLock: async () => undefined,
      activeLocks: new Map(),
      waitForMongoReady: async () => { order.push("ready"); return true; },
      cleanGuildCache: () => undefined,
      getGuildCacheSize: () => 0,
      adminAlert: async () => undefined,
      setAdminAlertDiscordClient: () => undefined,
      getOutboxPaused: async () => { getOutboxPausedCalls++; return pausedValue; },
      runMigrations: async () => { order.push("migrate"); return { applied: [1, 2] }; },
      requestContext: { run: <T>(_store: { requestId: string }, callback: () => T) => callback() },
      loadFetchSnapshot: async (_id: string) => { order.push("loadUpdates"); return { payload: [{ x: 1 }], fetchedAt: overrides.updatesFetchedAt ?? new Date() }; },
      loadDealsFetchSnapshots: async () => { order.push("loadDeals"); return [{ currency: "USD", payload: [{ d: 1 }], fetchedAt: new Date() }]; }
    },
    commands: {
      checkForUpdates: async () => undefined,
      checkForDiscounts: async () => undefined,
      checkForYouTube: async () => undefined,
      cleanCache: () => undefined,
      drainOutbox: async () => ({}),
      getCacheSizes: () => ({ single: 0, dlc: 0, updatesValid: false, dealsCurrenciesValid: 0, userCooldowns: 0 }),
      handleInteraction: async () => undefined,
      registerSlashCommands: async () => undefined,
      canSendEmbeds: () => true,
      setDealsCache: (currency: string, payload: unknown) => { dealsCache.push([currency, payload]); },
      setGlobalCacheTtl: () => undefined,
      setUpdatesCache: (payload: unknown) => { updatesCache.push(payload); }
    },
    scrapers: {
      attachMetrics: () => undefined,
      cleanEnrichedCache: () => undefined,
      getEnrichedCacheSize: () => 0
    }
  };
  return {
    deps, order, updatesCache, dealsCache, shutdownCalls, registered,
    getEventsOpts: () => eventsOpts!,
    getOutboxWorkerOpts: () => outboxWorkerOpts,
    getOutboxPausedCalls: () => getOutboxPausedCalls
  };
}

test("createAppRuntime: start() ruleaza secventa de boot in ordine (connect -> migrate -> hydrate -> listen -> login)", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps);
  await app.start();
  assert.deepEqual(
    h.order,
    ["connect", "ready", "migrate", "redis.connect", "loadUpdates", "loadDeals", "listen", "login"],
    "boot-ul respecta ordinea connect -> ready -> migrate -> redis -> hydrate -> listen -> login"
  );
});

test("createAppRuntime: boot-ul conecteaza Redis dupa startup-ul Mongo si inainte de hidratarea cache-ului", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps);
  await app.start();
  const at = (label: string) => h.order.indexOf(label);
  assert.ok(at("redis.connect") !== -1, "boot-ul apeleaza redis.connect()");
  assert.ok(at("redis.connect") > at("migrate"), "redis.connect ruleaza dupa startup-ul Mongo");
  assert.ok(at("redis.connect") < at("loadUpdates"), "redis.connect ruleaza inainte de hidratarea cache-ului");
});

test("createAppRuntime: hidrateaza cache-urile din snapshot-uri proaspete", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps);
  await app.start();
  assert.equal(h.updatesCache.length, 1, "snapshot updates proaspat -> setUpdatesCache");
  assert.deepEqual(h.dealsCache, [["USD", [{ d: 1 }]]], "snapshot deals proaspat -> setDealsCache");
});

test("createAppRuntime: snapshot updates invechit (>30min) NU hidrateaza cache-ul", async () => {
  const h = makeDeps({ updatesFetchedAt: new Date(Date.now() - 31 * 60 * 1000) });
  const app = createAppRuntime(h.deps);
  await app.start();
  assert.equal(h.updatesCache.length, 0, "snapshot vechi -> fara setUpdatesCache");
});

test("createAppRuntime: registerProcessHandlers si stop deleaga catre shutdown controller", async () => {
  const h = makeDeps();
  const app = createAppRuntime(h.deps);
  app.registerProcessHandlers();
  assert.equal(h.registered.count, 1, "registerProcessHandlers deleaga o data");
  await app.stop("SIGTERM", 0);
  assert.deepEqual(h.shutdownCalls, [{ signal: "SIGTERM", code: 0 }], "stop deleaga catre shutdown.shutdown");
});

test("createAppRuntime: cableaza event-urile Discord (cron + housekeeping)", () => {
  const h = makeDeps();
  createAppRuntime(h.deps);
  const opts = h.getEventsOpts();
  assert.equal(typeof opts.scheduleNextCron, "function", "scheduleNextCron este cablat in event-uri");
  assert.equal(typeof opts.startHousekeeping, "function", "startHousekeeping este cablat in event-uri");
});

test("createAppRuntime: outboxWorker primeste isPaused cablat la getOutboxPaused", async () => {
  const h = makeDeps();
  createAppRuntime(h.deps);
  const opts = h.getOutboxWorkerOpts();
  assert.ok(opts, "createOutboxWorker a primit optiunile");
  assert.equal(typeof opts!.isPaused, "function", "isPaused este cablat in optiunile worker-ului");
  const before = h.getOutboxPausedCalls();
  const result = await (opts!.isPaused as () => Promise<boolean>)();
  assert.equal(h.getOutboxPausedCalls(), before + 1, "isPaused() deleaga la getOutboxPaused");
  assert.equal(result, false, "isPaused reflecta valoarea returnata de getOutboxPaused");
});

test("connectMongoWithRetry: reincearca dupa un esec apoi reuseste", async () => {
  let attempts = 0;
  const deps: Parameters<typeof connectMongoWithRetry>[0] = {
    mongoose: { connect: async () => { attempts++; if (attempts < 2) throw new Error("ECONNREFUSED"); } },
    errorMessage: (err: unknown) => String(err),
    mongo: {
      logger: () => undefined,
      env: { MONGO_URI: "mongodb://x", MONGO_MAX_POOL_SIZE: 5 }
    }
  };
  await connectMongoWithRetry(deps);
  assert.equal(attempts, 2, "a doua incercare reuseste dupa backoff");
});

test("hydrateStartupCaches: hidrateaza din proaspat, ignora invechit", async () => {
  const updatesCache: unknown[] = [];
  const dealsCache: Array<[string, unknown]> = [];
  const deps: Parameters<typeof hydrateStartupCaches>[0] = {
    commands: {
      setUpdatesCache: (p: unknown) => { updatesCache.push(p); },
      setDealsCache: (c: string, p: unknown) => { dealsCache.push([c, p]); }
    },
    mongo: {
      logger: () => undefined,
      loadFetchSnapshot: async () => ({ payload: [{ x: 1 }], fetchedAt: new Date(Date.now() - 31 * 60 * 1000) }),
      loadDealsFetchSnapshots: async () => [{ currency: "USD", payload: [{ d: 1 }], fetchedAt: new Date() }]
    }
  };
  await hydrateStartupCaches(deps);
  assert.equal(updatesCache.length, 0, "snapshot updates invechit -> ignorat");
  assert.deepEqual(dealsCache, [["USD", [{ d: 1 }]]], "snapshot deals proaspat -> hidratat");
});
