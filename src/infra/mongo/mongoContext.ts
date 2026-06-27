"use strict";

import type { Model } from "mongoose";
import type { ActiveLocks, CurrencyCode, CurrencyConfig, CurrencyRegistry, DealInfo, GuildSettings, LoggerFunction, PriceValue, RuntimeEnv, SystemTimes, ValidatedDealInfo } from "../../types";
import type {
  AdminAlertCooldownDoc,
  CircuitBreakerDoc,
  FeedbackReportDoc,
  FetchSnapshotDoc,
  GuildDoc,
  GuildSeenDiscountDoc,
  GuildSeenUpdateDoc,
  GuildSeenYoutubeDoc,
  JobLockDoc,
  NotificationDeadLetterReplayDoc,
  NotificationHistoryDoc,
  NotificationOutboxDoc,
  NotificationOutboxSentDoc,
  SystemDoc
} from "./modelTypes";
import { assertNoUndefinedExports } from "../../shared/assertCompleteExports";

type MongoRuntimeContext = {
  logger: LoggerFunction;
  env: RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string };
  parseEnvNumber: (name: string, defaultValue: number, limits?: { min?: number; max?: number }) => number;
  runConcurrent: <T>(items: T[], concurrency: number, fn: (item: T, index: number) => void | Promise<unknown>, options?: unknown) => Promise<{ processed: number; errors: Array<{ error: unknown }> }>;
  waitForMongoReady: (timeoutMs?: number) => Promise<boolean>;
  validatePendingDiscountSnapshot: (snapshot: unknown) => snapshot is ValidatedDealInfo;
  validateUpdateFetchSnapshot: (item: unknown) => boolean;
  isTransientMongoError: (err: unknown) => boolean;
  withMongoRetry: <T>(fn: () => Promise<T>, ...rest: unknown[]) => Promise<T>;
  GuildModel: Model<GuildDoc>;
  CircuitBreakerModel: Model<CircuitBreakerDoc>;
  SystemModel: Model<SystemDoc>;
  JobLockModel: Model<JobLockDoc>;
  AdminAlertCooldownModel: Model<AdminAlertCooldownDoc>;
  FetchSnapshotModel: Model<FetchSnapshotDoc>;
  GuildSeenDiscountModel: Model<GuildSeenDiscountDoc>;
  GuildSeenUpdateModel: Model<GuildSeenUpdateDoc>;
  GuildSeenYoutubeModel: Model<GuildSeenYoutubeDoc>;
  NotificationOutboxModel: Model<NotificationOutboxDoc>;
  NotificationOutboxSentModel: Model<NotificationOutboxSentDoc>;
  NotificationHistoryModel: Model<NotificationHistoryDoc>;
  FeedbackReportModel: Model<FeedbackReportDoc>;
  NotificationDeadLetterReplayModel: Model<NotificationDeadLetterReplayDoc>;
  saveFetchSnapshot: (id: string, payload: unknown) => Promise<void>;
  loadFetchSnapshot: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  loadDealsFetchSnapshots: () => Promise<Array<{ currency: string; payload: unknown; fetchedAt: Date }>>;
  acquireDbLock: (jobName: string, ttlMs?: number) => Promise<string | null>;
  renewDbLock: (jobName: string, token: string, ttlMs?: number) => Promise<boolean>;
  releaseDbLock: (jobName: string, token: string) => Promise<void>;
  activeLocks: ActiveLocks;
  runMigrations: (logger: unknown) => Promise<{ applied: number[] }>;
  ALL_MIGRATIONS: readonly unknown[];
  getSystemTimes: () => Promise<SystemTimes>;
  saveSystemTimes: (times: SystemTimes) => Promise<void>;
  saveSystemTime: (key: keyof SystemTimes, value: number) => Promise<void>;
  getOutboxPaused: () => Promise<boolean>;
  setOutboxPaused: (paused: boolean) => Promise<void>;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  invalidateGuildCache: (guildId: string) => void;
  cleanGuildCache: () => void;
  getGuildCacheSize: () => number;
  adminAlert: (kind: string, title: string, body: unknown, guildId?: string) => Promise<void>;
  setAdminAlertDiscordClient: (client: { user?: { id?: string } | null; channels: { fetch(channelId: string): Promise<unknown> | unknown } } | null) => void;
  SchemaDriftError: new (...args: unknown[]) => Error;
  SUPPORTED_CURRENCIES: CurrencyRegistry;
  DEFAULT_CURRENCY: CurrencyCode;
  getCurrencyConfig: (code?: CurrencyCode | string | null) => CurrencyConfig;
  formatPrice: (value: PriceValue, currencyCode?: CurrencyCode | string | null) => string;
  requestContext: { run<T>(store: { requestId: string; abortSignal?: AbortSignal }, callback: () => T): T };
  getAbortSignal: () => AbortSignal | null;
};

type MongoInstaller = (target: MongoRuntimeContext) => void;

const runtimeContext = require("./runtime") as MongoRuntimeContext;
const defaultInstallers: MongoInstaller[] = [
  require("../../shared/logging"),
  require("../../shared/domain"),
  require("../../shared/env"),
  require("../../shared/utilities"),
  require("./models"),
  require("./locks"),
  require("./migrations"),
  require("./systemState"),
  require("./guildSettings"),
  require("./adminAlerts"),
  require("./fetchSnapshots")
];

function buildMongoContextExports(context: MongoRuntimeContext): MongoRuntimeContext {
  return {
    logger: context.logger,
    env: context.env,
    parseEnvNumber: context.parseEnvNumber,
    runConcurrent: context.runConcurrent,
    waitForMongoReady: context.waitForMongoReady,
    validatePendingDiscountSnapshot: context.validatePendingDiscountSnapshot,
    validateUpdateFetchSnapshot: context.validateUpdateFetchSnapshot,
    isTransientMongoError: context.isTransientMongoError,
    withMongoRetry: context.withMongoRetry,
    GuildModel: context.GuildModel,
    CircuitBreakerModel: context.CircuitBreakerModel,
    SystemModel: context.SystemModel,
    JobLockModel: context.JobLockModel,
    AdminAlertCooldownModel: context.AdminAlertCooldownModel,
    FetchSnapshotModel: context.FetchSnapshotModel,
    GuildSeenDiscountModel: context.GuildSeenDiscountModel,
    GuildSeenUpdateModel: context.GuildSeenUpdateModel,
    GuildSeenYoutubeModel: context.GuildSeenYoutubeModel,
    NotificationOutboxModel: context.NotificationOutboxModel,
    NotificationOutboxSentModel: context.NotificationOutboxSentModel,
    NotificationHistoryModel: context.NotificationHistoryModel,
    FeedbackReportModel: context.FeedbackReportModel,
    NotificationDeadLetterReplayModel: context.NotificationDeadLetterReplayModel,
    saveFetchSnapshot: context.saveFetchSnapshot,
    loadFetchSnapshot: context.loadFetchSnapshot,
    loadDealsFetchSnapshots: context.loadDealsFetchSnapshots,
    acquireDbLock: context.acquireDbLock,
    renewDbLock: context.renewDbLock,
    releaseDbLock: context.releaseDbLock,
    activeLocks: context.activeLocks,
    runMigrations: context.runMigrations,
    ALL_MIGRATIONS: context.ALL_MIGRATIONS,
    getSystemTimes: context.getSystemTimes,
    saveSystemTimes: context.saveSystemTimes,
    saveSystemTime: context.saveSystemTime,
    getOutboxPaused: context.getOutboxPaused,
    setOutboxPaused: context.setOutboxPaused,
    getGuildSettings: context.getGuildSettings,
    invalidateGuildCache: context.invalidateGuildCache,
    cleanGuildCache: context.cleanGuildCache,
    getGuildCacheSize: context.getGuildCacheSize,
    adminAlert: context.adminAlert,
    setAdminAlertDiscordClient: context.setAdminAlertDiscordClient,
    SchemaDriftError: context.SchemaDriftError,
    SUPPORTED_CURRENCIES: context.SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY: context.DEFAULT_CURRENCY,
    getCurrencyConfig: context.getCurrencyConfig,
    formatPrice: context.formatPrice,
    requestContext: context.requestContext,
    getAbortSignal: context.getAbortSignal
  };
}

function createMongoContext(
  baseContext: MongoRuntimeContext = runtimeContext,
  installers: MongoInstaller[] = defaultInstallers
) {
  const context = baseContext;
  for (const install of installers) install(context);
  return buildMongoContextExports(context);
}

const mongoContext = Object.assign(
  assertNoUndefinedExports(createMongoContext(), "mongoContext"),
  { createMongoContext }
);

export = mongoContext;
