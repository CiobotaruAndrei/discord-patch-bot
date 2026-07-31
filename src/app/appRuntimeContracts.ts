"use strict";

import type { GuildSettingsEventBus } from "../infra/mongo/guildSettingsEventBus.js";
import type { HttpServerMetricRecorder, MetricRecorders } from "../shared/metricRecorderPorts.js";
import type { HttpRequestOptions } from "../sources/httpRequestTypes.js";
import type { ActiveLocks, BotRole, LifecycleState } from "../types.js";
import type { BotMetrics } from "./health/metricsTypes.js";
import type { RateLimiter } from "./health/rateLimitTypes.js";
import type { CronController } from "./scheduler/schedulerTypes.js";
import type { BotConfig, ConfigLoadResult, GameConfig } from "../config/configTypes.js";
import type { RuntimeEnv } from "../config/runtimeEnvTypes.js";
import type { CommandCacheSizes } from "../features/command-cache/commandCacheTypes.js";
import type { DealInfo, FetchResult } from "../sources/sourceTypes.js";
import type { CreateCronControllerDeps } from "./scheduler/cron.js";
import type { CreateHousekeepingDeps, HousekeepingController } from "./scheduler/housekeeping.js";
import type { MongoPorts } from "../infra/mongo/mongoPorts.js";
import type { SourcePorts } from "../sources/sourceRegistryPorts.js";
import type { CreateOutboxWorkerDeps, OutboxDrainResult, OutboxWorker } from "./scheduler/outboxWorker.js";
import type { CreateHttpServerDeps } from "./health/httpServer.js";
import type { RegisterDiscordEventsDeps, RegisterMongoEventsDeps } from "./lifecycle/events.js";
import type { LifecycleDiscordChannel, LifecycleDiscordInteraction, LifecycleEventClient } from "./lifecycle/lifecycleContracts.js";
import type { CreateShutdownControllerDeps, ShutdownController } from "./lifecycle/shutdown.js";
import type { OutboxDiscordClient } from "../features/notifications/outboundChannel.js";
import type { RedisRuntime } from "../infra/redis/redisClient.js";
import type { GuildSettings } from "../features/guild-config/guildSettingsTypes.js";

import type { GuildAuditLogModelLike } from "../features/admin-records/auditLogRepository.js";
import type { ModerationGuildModel } from "../features/moderation/moderationRepository.js";
import type { GuildConfigWriteModelLike } from "../features/guild-config/guildConfigRepository.js";
import type { NewAccountAlertDeliveryModelLike } from "../features/command-security/newAccountAlertDedup.js";
import type { ChannelLockRecoveryModelLike } from "../features/command-security/channelLockRecoveryRepository.js";

export interface CommandRuntime {
  checkForUpdates(client: DiscordClientLike, games: GameConfig[], shouldAbort: () => boolean): Promise<void>;
  checkForDiscounts(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  checkForDlcs?(client: DiscordClientLike, games: GameConfig[], shouldAbort: () => boolean): Promise<void>;
  checkForFutureReleases?(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  checkForYouTube(client: DiscordClientLike, shouldAbort: () => boolean): Promise<void>;
  refreshPlayerCountSnapshots?(games: GameConfig[], shouldAbort: () => boolean, client?: DiscordClientLike): Promise<unknown>;
  refreshReviewTrendSnapshots?(games: GameConfig[], shouldAbort: () => boolean): Promise<unknown>;
  cleanCache(): void;
  drainOutbox(client: OutboxDiscordClient, shouldAbort?: () => boolean): Promise<OutboxDrainResult> | OutboxDrainResult;
  getCacheSizes(): CommandCacheSizes;
  handleInteraction(interaction: LifecycleDiscordInteraction, games: GameConfig[]): Promise<unknown>;
  registerSlashCommands(token: string, clientId: string): Promise<void>;
  canSendEmbeds(channel: LifecycleDiscordChannel, botId: string): boolean;
  setDealsCache(currency: string, data: DealInfo[]): void;
  setGlobalCacheTtl(ms: number): void;
  setUpdatesCache(data: FetchResult[] | null): void;
}

export interface ScraperRuntime {
  attachMetrics(metrics: BotMetrics): void;
  cleanEnrichedCache(): void;
  getEnrichedCacheSize(): number;
  httpReq?(method: string, url: string, options?: HttpRequestOptions): Promise<{ data: unknown; headers?: Record<string, unknown> }>;
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
  releaseDbLock: (jobName: string, token: string) => Promise<void>;
  activeLocks: ActiveLocks;
  waitForMongoReady: (timeoutMs: number) => Promise<boolean>;
  cleanGuildCache: () => void;
  getGuildCacheSize: () => number;
  adminAlert: (kind: string, title: string, body: string, guildId?: string) => Promise<void>;
  getGuildSettings?: (guildId: string) => Promise<GuildSettings | null>;
  guildSettingsBus: GuildSettingsEventBus;
  GuildModel?: ModerationGuildModel & GuildConfigWriteModelLike;
  GuildModerationModel?: ModerationGuildModel;
  GuildAuditLogModel?: GuildAuditLogModelLike;
  NewAccountAlertDeliveryModel?: NewAccountAlertDeliveryModelLike;
  ChannelLockRecoveryModel?: ChannelLockRecoveryModelLike;
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
  guilds?: { cache: { values(): IterableIterator<{ id: string; members: { fetch(): Promise<{ values(): IterableIterator<{ id: string; communicationDisabledUntil?: Date | null }> }> } }> } };
  login(token: string): Promise<unknown>;
  destroy(): void | Promise<void>;
  isReady(): boolean;
}

export interface RuntimePorts {
  mongo: MongoPorts;
  sources: SourcePorts;
}

export interface AppRuntimeDeps {
  mongoose: MongooseLike;
  crypto: CryptoLike;
  performance: PerformanceLike;
  Client: new (opts: { intents: number[] }) => DiscordClientLike;
  GatewayIntentBits: typeof import("discord.js").GatewayIntentBits;
  loadConfig: () => ConfigLoadResult;
  createMetrics: () => BotMetrics;
  createRateLimiter: (env: RuntimeEnv, metrics: HttpServerMetricRecorder) => RateLimiter;
  createHousekeeping: (opts: CreateHousekeepingDeps) => HousekeepingController;
  ports: RuntimePorts;
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
  recorders: MetricRecorders;
  lifecycle: LifecycleState;
  rateLimiter: RateLimiter;
  config: BotConfig;
  games: GameConfig[];
}

export interface Schedulers {
  cronController: CronController;
  outboxWorker: OutboxWorker;
  outboxEnabled: boolean;
  housekeeping: HousekeepingController;
}

export interface AppRuntime {
  start(): Promise<void>;
  stop(signal: string, exitCode?: number): Promise<void>;
  registerProcessHandlers(): void;
  cronController: CronController | null;
  outboxWorker: OutboxWorker | null;
  httpServer: HttpServerLike;
  metrics: BotMetrics;
}

