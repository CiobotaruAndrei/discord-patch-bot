import test from "node:test";
import assert from "node:assert/strict";
import { GatewayIntentBits } from "discord.js";
import { createAppRuntime, createWebRuntime, createWorkerRuntime } from "../../app/appRuntime.js";
import type { AppRuntimeDeps } from "../../app/appRuntime.js";
import { createShutdownController } from "../../app/lifecycle/shutdown.js";
import type { RuntimeEnv, BotRole } from "../../types.js";
import type { RegisterDiscordEventsDeps } from "../../app/lifecycle/events.js";
import { createMetrics } from "../../app/health/metrics.js";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";

function makeGraphHarness(role?: BotRole) {
  const factoryCalls = { cron: 0, outbox: 0, housekeeping: 0, httpServer: 0 };
  let eventsOpts: RegisterDiscordEventsDeps | undefined;
  let shutdownOpts: Parameters<AppRuntimeDeps["createShutdownController"]>[0] | undefined;

  class FakeClient {
    user = null;
    channels = { fetch: async () => null };
    login = async () => "ok";
    destroy = () => undefined;
    isReady = () => true;
    once = () => undefined;
    on = () => undefined;
  }

  const deps: AppRuntimeDeps = {
    mongoose: {
      connect: async () => undefined,
      connection: { readyState: 1, close: async () => undefined, on: () => undefined }
    },
    crypto: { randomBytes: (size: number) => Buffer.alloc(size), timingSafeEqual: () => true },
    performance: { now: () => 0 },
    Client: FakeClient,
    GatewayIntentBits,
    loadConfig: () => ({ config: { games: [] }, games: [], configPath: "test-config.json" }),
    createMetrics,
    createRateLimiter: () => ({ check: () => true, prune: () => undefined, size: 0, retryAfterSeconds: 1 }),
    createHousekeeping: () => { factoryCalls.housekeeping++; return { start: () => undefined, stop: async () => undefined }; },
    createCronController: () => {
      factoryCalls.cron++;
      return {
        scheduleNextCron: () => undefined,
        runCronCycle: async () => undefined,
        stop: () => undefined,
        shouldAbortCron: () => false,
        getHealthSnapshot: () => ({ successRatio: null, windowSize: 0, healthSkipScheduled: false })
      };
    },
    createOutboxWorker: () => { factoryCalls.outbox++; return { start: () => undefined, stop: () => undefined, drainTick: async () => undefined }; },
    createHttpServer: () => {
      factoryCalls.httpServer++;
      return {
        on: () => undefined,
        listen: (_port: number | string, cb?: () => void) => { if (cb) cb(); },
        close: () => undefined
      };
    },
    registerDiscordEvents: (opts) => { eventsOpts = opts; },
    registerMongoEvents: () => undefined,
    createShutdownController: (opts) => {
      shutdownOpts = opts;
      return {
        shutdown: async () => undefined,
        handleFatalProcessError: () => undefined,
        registerProcessHandlers: () => undefined
      };
    },
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    redis: {
      enabled: false,
      getClient: () => null,
      status: () => "disabled",
      connect: async () => undefined,
      close: async () => undefined
    },
    mongo: {
      logger: () => undefined,
      env: { MONGO_URI: "mongodb://x", MONGO_MAX_POOL_SIZE: 5, PORT: "3000", DISCORD_TOKEN: "t" } as RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string },
      parseEnvNumber: (_n: string, d: number) => d,
      acquireDbLock: async () => "tok",
      renewDbLock: async () => true,
      releaseDbLock: async () => undefined,
      activeLocks: new Map(),
      waitForMongoReady: async () => true,
      cleanGuildCache: () => undefined,
      getGuildCacheSize: () => 0,
      adminAlert: async () => undefined,
      setAdminAlertDiscordClient: () => undefined,
      getOutboxPaused: async () => false,
      runMigrations: async () => ({ applied: [] }),
      requestContext: { run: <T>(_store: { requestId: string }, callback: () => T) => callback() },
      loadFetchSnapshot: async () => null,
      loadDealsFetchSnapshots: async () => []
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
      setDealsCache: () => undefined,
      setGlobalCacheTtl: () => undefined,
      setUpdatesCache: () => undefined
    },
    scrapers: {
      attachMetrics: () => undefined,
      cleanEnrichedCache: () => undefined,
      getEnrichedCacheSize: () => 0
    },
    ...(role === undefined ? {} : { role })
  };
  return {
    deps, factoryCalls,
    getEventsOpts: () => eventsOpts!,
    getShutdownOpts: () => shutdownOpts!
  };
}

test("createWebRuntime: graful web NU construieste cron/outbox/housekeeping (review nou, Mare #4)", () => {
  const h = makeGraphHarness();
  const app = createWebRuntime(h.deps);
  assert.deepEqual(h.factoryCalls, { cron: 0, outbox: 0, housekeeping: 0, httpServer: 1 }, "web construieste doar partea comuna (http server), fara subgraful de schedulere");
  assert.equal(app.cronController, null, "runtime-ul web nu expune cronController");
  assert.equal(app.outboxWorker, null, "runtime-ul web nu expune outboxWorker");
  const events = h.getEventsOpts();
  assert.equal(events.role, "web");
  assert.equal(events.startHousekeeping, undefined, "web nu primeste hook de housekeeping");
  assert.equal(events.scheduleNextCron, undefined, "web nu primeste hook de cron");
  assert.equal(events.startOutboxWorker, undefined, "web nu primeste hook de outbox");
  const shutdown = h.getShutdownOpts();
  assert.equal(shutdown.cronController, undefined, "shutdown-ul web nu are cron de oprit");
  assert.equal(shutdown.outboxWorker, undefined, "shutdown-ul web nu are outbox de oprit");
  assert.equal(shutdown.housekeeping, undefined, "shutdown-ul web nu are housekeeping de oprit");
});

test("createWorkerRuntime: graful worker construieste subgraful complet de schedulere (review nou, Mare #4)", () => {
  const h = makeGraphHarness();
  const app = createWorkerRuntime(h.deps);
  assert.deepEqual(h.factoryCalls, { cron: 1, outbox: 1, housekeeping: 1, httpServer: 1 }, "worker construieste cron + outbox + housekeeping + partea comuna");
  assert.notEqual(app.cronController, null, "runtime-ul worker expune cronController");
  assert.notEqual(app.outboxWorker, null, "runtime-ul worker expune outboxWorker");
  const events = h.getEventsOpts();
  assert.equal(events.role, "worker");
  assert.equal(typeof events.startHousekeeping, "function");
  assert.equal(typeof events.scheduleNextCron, "function");
  const shutdown = h.getShutdownOpts();
  assert.equal(typeof shutdown.cronController?.stop, "function", "shutdown-ul worker opreste cron-ul");
  assert.equal(typeof shutdown.housekeeping?.stop, "function", "shutdown-ul worker opreste housekeeping-ul");
});

test("createAppRuntime dispatch pe rol: 'web' -> graf web, 'worker' -> graf worker, implicit/'all' -> graf complet", () => {
  const web = makeGraphHarness("web");
  createAppRuntime(web.deps);
  assert.deepEqual(web.factoryCalls, { cron: 0, outbox: 0, housekeeping: 0, httpServer: 1 });

  const worker = makeGraphHarness("worker");
  createAppRuntime(worker.deps);
  assert.deepEqual(worker.factoryCalls, { cron: 1, outbox: 1, housekeeping: 1, httpServer: 1 });

  const combined = makeGraphHarness();
  const combinedApp = createAppRuntime(combined.deps);
  assert.deepEqual(combined.factoryCalls, { cron: 1, outbox: 1, housekeeping: 1, httpServer: 1 }, "fara rol => 'all' => graful complet, comportamentul de dinainte");
  assert.notEqual(combinedApp.cronController, null);
  assert.equal(combined.getEventsOpts().role, undefined, "rolul ramane cel din deps (nesetat => all implicit in events)");
});

test("shutdown-ul real functioneaza fara subgraful de schedulere (graful web se inchide curat)", async () => {
  const logs: string[] = [];
  const controller = createShutdownController({
    lifecycle: { isShuttingDown: false },
    logger: (_level, _ctx, message) => { logs.push(message); },
    env: { SHUTDOWN_DRAIN_MS: 0 } as Pick<RuntimeEnv, "SHUTDOWN_DRAIN_MS">,
    client: { destroy: () => undefined },
    mongoose: { connection: { close: async () => undefined } },
    httpServer: { close: (cb?: (err?: Error) => void) => { if (cb) cb(); } },
    activeLocks: new Map(),
    releaseDbLock: async () => undefined,
    adminAlert: async () => undefined,
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err)
  });
  await assert.doesNotReject(async () => controller.shutdown("SIGTERM", 0), "shutdown fara cron/outbox/housekeeping nu arunca");
  assert.ok(logs.some(message => message.includes("SIGTERM")), "shutdown-ul a rulat efectiv");
});
