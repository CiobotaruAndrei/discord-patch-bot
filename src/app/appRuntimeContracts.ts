"use strict";

import type {
  ActiveLocks,
  BotConfig,
  BotMetrics,
  BotRole,
  CommandCacheSizes,
  ConfigLoadResult,
  DealInfo,
  FetchResult,
  CronController,
  GameConfig,
  LifecycleState,
  RateLimiter,
  RuntimeEnv
} from "../types.js";
import type { CreateCronControllerDeps } from "./scheduler/cron.js";
import type { CreateHousekeepingDeps, HousekeepingController } from "./scheduler/housekeeping.js";
import type { CreateOutboxWorkerDeps, OutboxWorker } from "./scheduler/outboxWorker.js";
import type { CreateHttpServerDeps } from "./health/httpServer.js";
import type { RegisterDiscordEventsDeps, RegisterMongoEventsDeps } from "./lifecycle/events.js";
import type { LifecycleDiscordChannel, LifecycleDiscordInteraction, LifecycleEventClient } from "./lifecycle/lifecycleContracts.js";
import type { CreateShutdownControllerDeps, ShutdownController } from "./lifecycle/shutdown.js";
import type { OutboxDiscordClient } from "../features/notifications/outboundChannel.js";
import type { RedisRuntime } from "../infra/redis/redisClient.js";
import type { GuildSettings } from "../features/guild-config/guildSettingsTypes.js";
import type { GuildAuditLogModelLike } from "../features/admin-records/auditLogRepository.js";

export interface CommandRuntime {
  checkForUpdates(client: DiscordClientLike, games: GameConfig[], shouldAbort: () => boolean): Promise<void>;
  checkForDiscounts(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  checkForYouTube(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  cleanCache(): void;
  drainOutbox(client: OutboxDiscordClient, shouldAbort?: () => boolean): Promise<unknown> | unknown;
  getCacheSizes(): CommandCacheSizes;
  handleInteraction(interaction: LifecycleDiscordInteraction, games: GameConfig[]): Promise<unknown> | unknown;
  registerSlashCommands(token: string, clientId: string): Promise<unknown>;
  canSendEmbeds(channel: LifecycleDiscordChannel, botId: string): boolean;
  setDealsCache(currency: string, data: DealInfo[]): void;
  setGlobalCacheTtl(ms: number): void;
  setUpdatesCache(data: FetchResult[] | null): void;
}

export interface ScraperRuntime {
  attachMetrics(metrics: BotMetrics): void;
  cleanEnrichedCache(): unknown;
  getEnrichedCacheSize(): number;
}

export interface HttpServerLike {
  on(event: "error", listener: (err: Error) => void): unknown;
  listen(port: number | string, callback?: () => void): unknown;
  close(callback?: (err?: Error) => void): unknown;
}

export type BootValidatedEnv = RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string };

export interface RequestContextLike {
  run<T>(store: { requestId: string; abortSignal?: AbortSignal }, callback: () => T): T;
}

export interface MongoContextLike {
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
  adminAlert: (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;
  getGuildSettings?: (guildId: string) => Promise<GuildSettings | null>;
  GuildAuditLogModel?: GuildAuditLogModelLike;
  recordServerAudit?: (entry: { guildId: string; action: string; userId?: string; details?: string }) => Promise<void>;
  setAdminAlertDiscordClient(client: DiscordClientLike | null): void;
  getOutboxPaused: () => Promise<boolean>;
  runMigrations: (logger: MongoContextLike["logger"]) => Promise<{ applied: number[] }>;
  requestContext: RequestContextLike;
  loadFetchSnapshot: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  loadDealsFetchSnapshots: () => Promise<Array<{ currency: string; payload: unknown; fetchedAt: Date }>>;
}

export interface MongooseLike {
  connect(uri: string, opts: { maxPoolSize: number }): Promise<unknown>;
  connection: {
    readyState: number;
    close(): Promise<void>;
    on(event: "connected" | "disconnected" | "reconnected", listener: () => unknown): unknown;
    on(event: "error", listener: (err: unknown) => unknown): unknown;
  };
}

export interface CryptoLike {
  randomBytes(size: number): Buffer;
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
}

export interface PerformanceLike {
  now(): number;
}

export interface DiscordClientLike extends LifecycleEventClient {
  channels: { fetch(channelId: string): Promise<LifecycleDiscordChannel | null> | LifecycleDiscordChannel | null };
  login(token: string): Promise<unknown>;
  destroy(): void | Promise<void>;
  isReady(): boolean;
}

export interface AppRuntimeDeps {
  mongoose: MongooseLike;
  crypto: CryptoLike;
  performance: PerformanceLike;
  Client: new (opts: { intents: number[] }) => DiscordClientLike;
  GatewayIntentBits: typeof import("discord.js").GatewayIntentBits;
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
  redis: RedisRuntime;
  role?: BotRole;
  mongo: MongoContextLike;
  commands: CommandRuntime;
  scrapers: ScraperRuntime;
  recoverOperationJournal?: () => Promise<{ recovered: number; failed: number }>;
  startOperationJournalRecovery?: () => void;
  stopOperationJournalRecovery?: () => Promise<void>;
}

export interface RuntimeServices {
  client: DiscordClientLike;
  metrics: BotMetrics;
  lifecycle: LifecycleState;
  rateLimiter: RateLimiter;
  housekeeping: HousekeepingController;
  config: BotConfig;
  games: GameConfig[];
}

export interface Schedulers {
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

