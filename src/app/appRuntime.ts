"use strict";

import type {
  ActiveLocks,
  BotConfig,
  BotMetrics,
  CommandCacheSizes,
  ConfigLoadResult,
  CronController,
  GameConfig,
  LifecycleState,
  RateLimiter,
  RuntimeEnv
} from "../types";
import type { CreateCronControllerDeps } from "./scheduler/cron";
import type { CreateHousekeepingDeps, HousekeepingController } from "./scheduler/housekeeping";
import type { CreateOutboxWorkerDeps, OutboxWorker } from "./scheduler/outboxWorker";
import type { CreateHttpServerDeps } from "./health/httpServer";
import type { RegisterDiscordEventsDeps, RegisterMongoEventsDeps } from "./lifecycle/events";
import type { CreateShutdownControllerDeps, ShutdownController } from "./lifecycle/shutdown";

const { ensureNativeFuzzy } = require("../native/fuzzy") as { ensureNativeFuzzy: () => boolean };

interface CommandRuntime {
  checkForUpdates(client: DiscordClientLike, games: GameConfig[], shouldAbort: () => boolean): Promise<void>;
  checkForDiscounts(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  cleanCache(): unknown;
  drainOutbox(client: unknown): Promise<unknown> | unknown;
  getCacheSizes(): CommandCacheSizes;
  handleInteraction(interaction: unknown, games: GameConfig[]): Promise<unknown> | unknown;
  registerSlashCommands(token: string, clientId: string): Promise<unknown>;
  canSendEmbeds(channel: unknown, botId: string): boolean;
  setDealsCache(currency: string, data: unknown): void;
  setGlobalCacheTtl(ms: number): void;
  setUpdatesCache(data: unknown): void;
}

interface ScraperRuntime {
  attachMetrics(metrics: BotMetrics): void;
  cleanEnrichedCache(): unknown;
  getEnrichedCacheSize(): number;
}

interface HttpServerLike {
  on(event: "error", listener: (err: Error) => void): unknown;
  listen(port: number | string, callback?: () => void): unknown;
  close(callback?: (err?: Error) => void): unknown;
}

type BootValidatedEnv = RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string };

interface RequestContextLike {
  run<T>(store: { requestId: string; abortSignal?: AbortSignal }, callback: () => T): T;
}

interface MongoContextLike {
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  env: BootValidatedEnv;
  parseEnvNumber: (name: string, def: number, limits: { min?: number; max?: number }) => number;
  acquireDbLock: (jobName: string, ttlMs: number) => Promise<string | null>;
  renewDbLock: (jobName: string, token: string, ttlMs: number) => Promise<boolean>;
  releaseDbLock: (jobName: string, token: string) => Promise<unknown>;
  activeLocks: ActiveLocks;
  waitForMongoReady: (timeoutMs: number) => Promise<boolean>;
  cleanGuildCache: () => unknown;
  getGuildCacheSize: () => number;
  adminAlert: (kind: string, title: string, body: string) => Promise<unknown>;
  getOutboxPaused: () => Promise<boolean>;
  runMigrations: (logger: unknown) => Promise<{ applied: number[] }>;
  requestContext: RequestContextLike;
  loadFetchSnapshot: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  loadDealsFetchSnapshots: () => Promise<Array<{ currency: string; payload: unknown; fetchedAt: Date }>>;
}

interface MongooseLike {
  connect(uri: string, opts: { maxPoolSize: number }): Promise<unknown>;
  connection: {
    readyState: number;
    close(): Promise<void>;
    on(event: "connected" | "disconnected" | "reconnected", listener: () => unknown): unknown;
    on(event: "error", listener: (err: unknown) => unknown): unknown;
  };
}

interface CryptoLike {
  randomBytes(size: number): Buffer;
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
}

interface PerformanceLike {
  now(): number;
}

interface DiscordClientLike {
  channels: { fetch(channelId: string): Promise<unknown> | unknown };
  login(token: string): Promise<unknown>;
  destroy(): void | Promise<void>;
  isReady(): boolean;
  user?: { id?: string; tag?: string } | null;
  once(event: "ready", listener: () => unknown): unknown;
  on(event: "interactionCreate", listener: (interaction: unknown) => unknown): unknown;
  on(event: "guildCreate", listener: (guild: unknown) => unknown): unknown;
  on(event: "error" | "shardError", listener: (err: unknown) => unknown): unknown;
  on(event: "warn", listener: (message: string) => unknown): unknown;
}

export interface AppRuntimeDeps {
  mongoose: MongooseLike;
  crypto: CryptoLike;
  performance: PerformanceLike;
  Client: new (opts: { intents: number[] }) => DiscordClientLike;
  GatewayIntentBits: Record<string, number>;
  loadConfig: () => ConfigLoadResult;
  createMetrics: () => BotMetrics;
  createRateLimiter: (env: RuntimeEnv, metrics: BotMetrics) => RateLimiter;
  createHousekeeping: (opts: CreateHousekeepingDeps) => HousekeepingController;
  createCronController: (opts: CreateCronControllerDeps) => CronController;
  createOutboxWorker: (opts: CreateOutboxWorkerDeps) => OutboxWorker;
  createHttpServer: (opts: CreateHttpServerDeps) => HttpServerLike;
  registerDiscordEvents: (opts: RegisterDiscordEventsDeps) => void;
  registerMongoEvents: (opts: RegisterMongoEventsDeps) => void;
  createShutdownController: (opts: CreateShutdownControllerDeps) => ShutdownController;
  errorMessage: (err: unknown) => string;
  errorDetail: (err: unknown) => string;
  mongo: MongoContextLike;
  commands: CommandRuntime;
  scrapers: ScraperRuntime;
}

interface RuntimeServices {
  client: DiscordClientLike;
  metrics: BotMetrics;
  lifecycle: LifecycleState;
  rateLimiter: RateLimiter;
  housekeeping: HousekeepingController;
  config: BotConfig;
  games: GameConfig[];
}

interface Schedulers {
  cronController: CronController;
  outboxWorker: OutboxWorker;
  outboxEnabled: boolean;
}

export interface AppRuntime {
  start(): Promise<void>;
  stop(signal: string, exitCode?: number): Promise<void>;
  registerProcessHandlers(): void;
  cronController: CronController;
  outboxWorker: OutboxWorker;
  httpServer: HttpServerLike;
  metrics: BotMetrics;
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
    drainOutbox: async (drainClient) => commands.drainOutbox(drainClient),
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
      if (!ensureNativeFuzzy()) {
        logger("WARN", "BOOT", "Addon Rust indisponibil — rulez cu fallback TypeScript (permis explicit in afara productiei sau prin ALLOW_NATIVE_FALLBACK).");
      }
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
        const continueOnError = process.env.MIGRATIONS_CONTINUE_ON_ERROR === "true";
        if (!continueOnError) {
          logger("ERROR", "MIGRATE", "Migrari esuate la boot — opresc pornirea (fail-fast pentru integritatea schemei; seteaza MIGRATIONS_CONTINUE_ON_ERROR=true ca sa pornesti oricum, pe propriul risc)", errorDetail(migErr));
          throw migErr;
        }
        logger("ERROR", "MIGRATE", "Migrari esuate la boot — continui fara ele (MIGRATIONS_CONTINUE_ON_ERROR=true; risc de schema inconsistenta, retry la urmatorul restart)", errorDetail(migErr));
        adminAlert("boot:migrations", "Migrari DB esuate la pornire (pornit oricum)", errorMessage(migErr)).catch(() => null);
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
