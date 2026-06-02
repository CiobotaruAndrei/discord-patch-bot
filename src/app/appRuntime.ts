"use strict";

type AnyFn = (...args: unknown[]) => unknown;

interface HousekeepingLike { start(): void; stop(): void }
interface CronControllerLike { scheduleNextCron(): void; runCronCycle(): Promise<void>; stop(): void; getHealthSnapshot(): unknown }
interface OutboxWorkerLike { start(): void; stop(): void }
interface HttpServerLike {
  on(event: "error", listener: (err: Error) => void): unknown;
  listen(port: number, callback?: () => void): unknown;
  close(callback?: (err?: Error) => void): unknown;
}
interface ShutdownControllerLike {
  shutdown(signal: string, exitCode?: number): Promise<void>;
  registerProcessHandlers(): void;
}

interface MongoContextLike {
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  env: { MONGO_URI: string; MONGO_MAX_POOL_SIZE: number; PORT: number; DISCORD_TOKEN: string } & Record<string, unknown>;
  parseEnvNumber: (name: string, def: number, limits: { min?: number; max?: number }) => number;
  acquireDbLock: AnyFn;
  renewDbLock: AnyFn;
  releaseDbLock: AnyFn;
  activeLocks: { size: number } & Record<string, unknown>;
  waitForMongoReady: (timeoutMs: number) => Promise<boolean>;
  cleanGuildCache: AnyFn;
  getGuildCacheSize: () => number;
  adminAlert: (kind: string, title: string, body: string) => Promise<unknown>;
  getOutboxPaused: () => Promise<boolean>;
  runMigrations: (logger: unknown) => Promise<{ applied: number[] }>;
  requestContext: unknown;
  loadFetchSnapshot: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  loadDealsFetchSnapshots: () => Promise<Array<{ currency: string; payload: unknown; fetchedAt: Date }>>;
}

interface MongooseLike {
  connect(uri: string, opts: Record<string, unknown>): Promise<unknown>;
  connection: { readyState: number };
}

interface DiscordClientLike { login(token: string): Promise<unknown> }

export interface AppRuntimeDeps {
  mongoose: MongooseLike;
  crypto: unknown;
  performance: unknown;
  Client: new (opts: unknown) => DiscordClientLike;
  GatewayIntentBits: Record<string, number>;
  loadConfig: () => { config: unknown; games: unknown[] };
  createMetrics: () => Record<string, unknown>;
  createRateLimiter: (env: unknown, metrics: unknown) => unknown;
  createHousekeeping: (opts: Record<string, unknown>) => HousekeepingLike;
  createCronController: (opts: Record<string, unknown>) => CronControllerLike;
  createOutboxWorker: (opts: Record<string, unknown>) => OutboxWorkerLike;
  createHttpServer: (opts: Record<string, unknown>) => HttpServerLike;
  registerDiscordEvents: (opts: Record<string, unknown>) => void;
  registerMongoEvents: (opts: Record<string, unknown>) => void;
  createShutdownController: (opts: Record<string, unknown>) => ShutdownControllerLike;
  errorMessage: (err: unknown) => string;
  errorDetail: (err: unknown) => string;
  mongo: MongoContextLike;
  commands: Record<string, AnyFn>;
  scrapers: { attachMetrics: (metrics: unknown) => void } & Record<string, unknown>;
}

interface RuntimeServices {
  client: DiscordClientLike;
  metrics: Record<string, unknown>;
  lifecycle: { isShuttingDown: boolean };
  rateLimiter: unknown;
  housekeeping: HousekeepingLike;
  config: unknown;
  games: unknown[];
}

interface Schedulers {
  cronController: CronControllerLike;
  outboxWorker: OutboxWorkerLike;
  outboxEnabled: boolean;
}

export interface AppRuntime {
  start(): Promise<void>;
  stop(signal: string, exitCode?: number): Promise<void>;
  registerProcessHandlers(): void;
  cronController: CronControllerLike;
  outboxWorker: OutboxWorkerLike;
  httpServer: HttpServerLike;
  metrics: Record<string, unknown>;
}

const MONGO_CONNECT_MAX_ATTEMPTS = 5;
const MONGO_CONNECT_INITIAL_BACKOFF_MS = 1000;
const MONGO_CONNECT_MAX_BACKOFF_MS = 16000;
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const BOOT_ALERT_BUDGET_MS = 3000;

function createRuntimeServices(deps: AppRuntimeDeps): RuntimeServices {
  const { Client, GatewayIntentBits, loadConfig, createMetrics, createRateLimiter, createHousekeeping, scrapers, commands, errorMessage, mongo } = deps;
  const { logger, env, cleanGuildCache } = mongo;

  const { config, games } = loadConfig();
  const metrics = createMetrics();
  scrapers.attachMetrics(metrics);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const lifecycle = { isShuttingDown: false };
  const rateLimiter = createRateLimiter(env, metrics);
  const housekeeping = createHousekeeping({
    commands, cleanGuildCache, scrapers, rateLimiter, logger, env, errorMessage
  });

  return { client, metrics, lifecycle, rateLimiter, housekeeping, config, games };
}

function createSchedulers(deps: AppRuntimeDeps, services: RuntimeServices): Schedulers {
  const { mongoose, performance, crypto, createCronController, createOutboxWorker, errorMessage, errorDetail, commands, mongo } = deps;
  const { logger, env, parseEnvNumber, acquireDbLock, renewDbLock, releaseDbLock, adminAlert, requestContext, getOutboxPaused } = mongo;
  const { client, metrics, lifecycle, config, games } = services;

  const cronController = createCronController({
    mongoose, performance, crypto, logger, env, parseEnvNumber,
    acquireDbLock, renewDbLock, releaseDbLock, commands, adminAlert,
    client, games, config, metrics, lifecycle, errorMessage, errorDetail, requestContext
  });

  const outboxEnabled = process.env.NOTIFICATION_OUTBOX_ENABLED === "true";
  const outboxDrainLimit = parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_LIMIT", 50, { min: 1, max: 1000 });
  const outboxPerJobBudgetMs = parseEnvNumber("DISCORD_SEND_RATE_MAX_WAIT_MS", 5000, { min: 0, max: 60000 }) + 2000;
  const outboxWorker = createOutboxWorker({
    mongoose, client, logger, parseEnvNumber, acquireDbLock, releaseDbLock,
    drainOutbox: (drainClient: unknown) => commands.drainOutbox(drainClient),
    lifecycle, metrics, errorMessage, adminAlert, isPaused: () => getOutboxPaused(),
    drainLimit: outboxDrainLimit, perJobBudgetMs: outboxPerJobBudgetMs
  });

  return { cronController, outboxWorker, outboxEnabled };
}

async function connectMongoWithRetry(deps: AppRuntimeDeps): Promise<void> {
  const { mongoose, errorMessage, mongo } = deps;
  const { logger, env } = mongo;
  let backoff = MONGO_CONNECT_INITIAL_BACKOFF_MS;
  for (let attempt = 1; attempt <= MONGO_CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(env.MONGO_URI, { maxPoolSize: env.MONGO_MAX_POOL_SIZE });
      if (attempt > 1) {
        logger("INFO", "BOOT", `Mongo conectat la incercarea ${attempt}/${MONGO_CONNECT_MAX_ATTEMPTS}`);
      }
      return;
    } catch (err) {
      if (attempt === MONGO_CONNECT_MAX_ATTEMPTS) throw err;
      const jitter = Math.round(backoff * (0.5 + Math.random() * 0.5));
      logger("WARN", "BOOT",
        `Mongo connect a esuat (incercarea ${attempt}/${MONGO_CONNECT_MAX_ATTEMPTS}), reincerc in ${jitter}ms`,
        errorMessage(err));
      await new Promise(resolve => setTimeout(resolve, jitter));
      backoff = Math.min(backoff * 2, MONGO_CONNECT_MAX_BACKOFF_MS);
    }
  }
}

async function hydrateStartupCaches(deps: AppRuntimeDeps): Promise<void> {
  const { commands, mongo } = deps;
  const { logger, loadFetchSnapshot, loadDealsFetchSnapshots } = mongo;
  const now = Date.now();
  let hydratedUpdates = false;
  let hydratedDeals = 0;
  const updatesSnapshot = await loadFetchSnapshot("updates");
  if (updatesSnapshot && Array.isArray(updatesSnapshot.payload)
      && now - updatesSnapshot.fetchedAt.getTime() < SNAPSHOT_MAX_AGE_MS) {
    commands.setUpdatesCache(updatesSnapshot.payload);
    hydratedUpdates = true;
  }
  for (const snapshot of await loadDealsFetchSnapshots()) {
    if (Array.isArray(snapshot.payload)
        && now - snapshot.fetchedAt.getTime() < SNAPSHOT_MAX_AGE_MS) {
      commands.setDealsCache(snapshot.currency, snapshot.payload);
      hydratedDeals++;
    }
  }
  if (hydratedUpdates || hydratedDeals) {
    logger("INFO", "BOOT", `Cache hidratat din snapshot DB: updates=${hydratedUpdates}, deals=${hydratedDeals}`);
  }
}

function createBootSequence(deps: AppRuntimeDeps, ctx: { client: DiscordClientLike; httpServer: HttpServerLike }): () => Promise<void> {
  const { errorMessage, errorDetail, mongo } = deps;
  const { logger, env, adminAlert, waitForMongoReady, runMigrations } = mongo;
  const { client, httpServer } = ctx;

  return async function start(): Promise<void> {
    try {
      await connectMongoWithRetry(deps);
      const mongoReady = await waitForMongoReady(10000);
      if (!mongoReady) {
        logger("WARN", "BOOT", "Mongo nu a confirmat conexiunea in timp util");
      }

      try {
        const migrations = await runMigrations(logger);
        if (migrations.applied.length) {
          logger("INFO", "MIGRATE", `Migrari aplicate: ${migrations.applied.join(", ")}`);
        }
      } catch (migErr) {
        logger("ERROR", "MIGRATE", "Migrari esuate la boot — continui fara ele (retry la urmatorul restart)", errorDetail(migErr));
        adminAlert("boot:migrations", "Migrari DB esuate la pornire", errorMessage(migErr)).catch(() => null);
      }

      try {
        await hydrateStartupCaches(deps);
      } catch (hydrateErr) {
        logger("WARN", "BOOT", "Hidratarea cache-ului din snapshot a esuat", errorMessage(hydrateErr));
      }

      httpServer.on("error", (err: Error) => {
        logger("ERROR", "HTTP", `httpServer error (port=${env.PORT})`, errorDetail(err));
        adminAlert("http:listen", "Eroare HTTP server", errorMessage(err)).catch(() => null);
      });
      httpServer.listen(env.PORT, () => {
        logger("INFO", "HTTP", `Health/metrics server pornit pe port ${env.PORT}`);
      });

      await client.login(env.DISCORD_TOKEN);
    } catch (err) {
      logger("ERROR", "BOOT", "Eroare la pornire", errorDetail(err));
      await Promise.race([
        adminAlert("boot:fatal", "Botul nu a putut porni", errorMessage(err)).catch(() => null),
        new Promise<void>(resolve => {
          const t = setTimeout(resolve, BOOT_ALERT_BUDGET_MS);
          if (typeof t.unref === "function") t.unref();
        })
      ]);
      throw err;
    }
  };
}

function createAppRuntime(deps: AppRuntimeDeps): AppRuntime {
  const { createHttpServer, registerDiscordEvents, registerMongoEvents, createShutdownController, errorMessage, errorDetail, mongoose, crypto, mongo } = deps;
  const { logger, env, getGuildCacheSize, activeLocks, releaseDbLock, requestContext, adminAlert } = mongo;

  const services = createRuntimeServices(deps);
  const { client, metrics, lifecycle, rateLimiter, housekeeping } = services;
  const schedulers = createSchedulers(deps, services);
  const { cronController, outboxWorker, outboxEnabled } = schedulers;

  const httpServer = createHttpServer({
    mongoose, crypto, env, client, metrics, commands: deps.commands,
    getGuildCacheSize, scrapers: deps.scrapers, activeLocks, rateLimiter, cronController
  });

  registerDiscordEvents({
    client, logger, commands: deps.commands, env, adminAlert, requestContext, games: services.games, crypto,
    errorMessage, errorDetail,
    startHousekeeping: housekeeping.start,
    scheduleNextCron: cronController.scheduleNextCron,
    startOutboxWorker: outboxEnabled ? outboxWorker.start : undefined
  });
  registerMongoEvents({ mongoose, logger, errorMessage });

  const shutdownController = createShutdownController({
    lifecycle, logger, env, client, mongoose, httpServer, activeLocks,
    releaseDbLock, cronController, outboxWorker, housekeeping, adminAlert,
    errorMessage, errorDetail
  });

  const start = createBootSequence(deps, { client, httpServer });

  return {
    start,
    stop: (signal: string, exitCode?: number) => shutdownController.shutdown(signal, exitCode),
    registerProcessHandlers: () => shutdownController.registerProcessHandlers(),
    cronController,
    outboxWorker,
    httpServer,
    metrics
  };
}

export { createAppRuntime, createRuntimeServices, createSchedulers, connectMongoWithRetry, hydrateStartupCaches, createBootSequence };
