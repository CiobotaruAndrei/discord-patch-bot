"use strict";

import type { ActiveLocks, CurrencyCode, CurrencyConfig, CurrencyRegistry, LoggerFunction, PriceValue, SystemTimes } from "../../types.js";
import type { RunConcurrent } from "../../shared/concurrencyPort.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import type { DealInfo, ValidatedDealInfo } from "../../sources/sourceTypes.js";
import type { OperationJournalDoc } from "../../shared/operationJournalEngine.js";
import { assertNoUndefinedExports } from "../../shared/assertCompleteExports.js";

export type MongoContextExports = MongoRuntimeContext;

type MongoRuntimeContext = {
  guildSettingsBus: GuildSettingsEventBus;
  mongoose: typeof import("mongoose");
  crypto: typeof import("node:crypto");
  axios: typeof import("axios").default;
  z: typeof import("zod").z;
  AsyncLocalStorage: typeof import("node:async_hooks").AsyncLocalStorage;
  logger: LoggerFunction;
  env: RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string };
  parseEnvNumber: (name: string, defaultValue: number, limits?: { min?: number; max?: number }) => number;
  runConcurrent: RunConcurrent;
  waitForMongoReady: (timeoutMs?: number) => Promise<boolean>;
  validatePendingDiscountSnapshot: (snapshot: unknown) => snapshot is ValidatedDealInfo;
  validateUpdateFetchSnapshot: (item: unknown) => boolean;
  isTransientMongoError: (err: unknown) => boolean;
  withMongoRetry: <T>(fn: () => Promise<T>, options?: { retries?: number; label?: string }) => Promise<T>;
  GuildModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildModel"];
  GuildModerationModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildModerationModel"];
  GuildSecurityModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildSecurityModel"];
  GuildYoutubeStateModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildYoutubeStateModel"];
  GuildAuditLogModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildAuditLogModel"];
  GuildConfigBackupModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildConfigBackupModel"];
  GuildSuggestedCommandModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildSuggestedCommandModel"];
  GuildYoutubeErrorModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildYoutubeErrorModel"];
  GuildDeadLetterModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildDeadLetterModel"];
  CircuitBreakerModel: ReturnType<typeof attachModelsModule.buildFrom>["CircuitBreakerModel"];
  SystemModel: ReturnType<typeof attachModelsModule.buildFrom>["SystemModel"];
  JobLockModel: ReturnType<typeof attachModelsModule.buildFrom>["JobLockModel"];
  AdminAlertCooldownModel: ReturnType<typeof attachModelsModule.buildFrom>["AdminAlertCooldownModel"];
  FetchSnapshotModel: ReturnType<typeof attachModelsModule.buildFrom>["FetchSnapshotModel"];
  PlayerCountSnapshotModel: ReturnType<typeof attachModelsModule.buildFrom>["PlayerCountSnapshotModel"];
  PlayerCountHistoryModel: ReturnType<typeof attachModelsModule.buildFrom>["PlayerCountHistoryModel"];
  ReviewTrendSnapshotModel: ReturnType<typeof attachModelsModule.buildFrom>["ReviewTrendSnapshotModel"];
  DealPriceSnapshotModel: ReturnType<typeof attachModelsModule.buildFrom>["DealPriceSnapshotModel"];
  NewAccountAlertDeliveryModel: ReturnType<typeof attachModelsModule.buildFrom>["NewAccountAlertDeliveryModel"];
  ChannelLockRecoveryModel: ReturnType<typeof attachModelsModule.buildFrom>["ChannelLockRecoveryModel"];
  PlayerCountRecordModel: ReturnType<typeof attachModelsModule.buildFrom>["PlayerCountRecordModel"];
  BugReportModel: ReturnType<typeof attachModelsModule.buildFrom>["BugReportModel"];
  UserComplaintModel: ReturnType<typeof attachModelsModule.buildFrom>["UserComplaintModel"];
  GuildSeenDiscountModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildSeenDiscountModel"];
  GuildSeenUpdateModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildSeenUpdateModel"];
  GuildSeenDlcModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildSeenDlcModel"];
  GuildSeenYoutubeModel: ReturnType<typeof attachModelsModule.buildFrom>["GuildSeenYoutubeModel"];
  NotificationOutboxModel: ReturnType<typeof attachModelsModule.buildFrom>["NotificationOutboxModel"];
  NotificationOutboxSentModel: ReturnType<typeof attachModelsModule.buildFrom>["NotificationOutboxSentModel"];
  NotificationHistoryModel: ReturnType<typeof attachModelsModule.buildFrom>["NotificationHistoryModel"];
  FeedbackReportModel: ReturnType<typeof attachModelsModule.buildFrom>["FeedbackReportModel"];
  NotificationDeadLetterReplayModel: ReturnType<typeof attachModelsModule.buildFrom>["NotificationDeadLetterReplayModel"];
  OperationJournalModel: ReturnType<typeof attachModelsModule.buildFrom>["OperationJournalModel"];
  saveFetchSnapshot: (id: string, payload: unknown) => Promise<void>;
  loadFetchSnapshot: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  loadDealsFetchSnapshots: () => Promise<Array<{ currency: string; payload: unknown; fetchedAt: Date }>>;
  loadSourceHealth: () => Promise<import("../../sources/sourceHealth.js").SourceHealthDoc[]>;
  acquireDbLock: (jobName: string, ttlMs?: number) => Promise<string | null>;
  renewDbLock: (jobName: string, token: string, ttlMs?: number) => Promise<boolean>;
  releaseDbLock: (jobName: string, token: string) => Promise<void>;
  activeLocks: ActiveLocks;
  runMigrations: ReturnType<typeof attachMigrationsModule.buildFrom>["runMigrations"];
  ALL_MIGRATIONS: ReturnType<typeof attachMigrationsModule.buildFrom>["ALL_MIGRATIONS"];
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
  SchemaDriftError: ReturnType<typeof attachDomainModule.buildFrom>["SchemaDriftError"];
  SUPPORTED_CURRENCIES: CurrencyRegistry;
  DEFAULT_CURRENCY: CurrencyCode;
  getCurrencyConfig: (code?: CurrencyCode | string | null) => CurrencyConfig;
  formatPrice: (value: PriceValue, currencyCode?: CurrencyCode | string | null) => string;
  requestContext: { run<T>(store: { requestId: string; abortSignal?: AbortSignal }, callback: () => T): T };
  getAbortSignal: () => AbortSignal | null;
};

import runtimeContextModule from "./runtime.js";
import attachLoggingModule from "../../shared/logging.js";
import attachDomainModule from "../../shared/domain.js";
import attachEnvModule from "../../shared/env.js";
import attachUtilitiesModule from "../../shared/utilities.js";
import attachModelsModule from "./models.js";
import attachLocksModule from "./locks.js";
import attachMigrationsModule from "./migrations.js";
import attachSystemStateModule from "./systemState.js";
import attachGuildSettingsModule from "./guildSettings.js";
import attachAdminAlertsModule from "./adminAlerts.js";
import attachFetchSnapshotsModule from "./fetchSnapshots.js";
import attachSourceHealthModule from "./sourceHealth.js";
import { createGuildSettingsEventBus } from "./guildSettingsEventBus.js";
import type { GuildSettingsEventBus } from "./guildSettingsEventBus.js";

function buildMongoContextExports(context: MongoRuntimeContext): MongoRuntimeContext {
  return {
    guildSettingsBus: context.guildSettingsBus,
    mongoose: context.mongoose,
    crypto: context.crypto,
    axios: context.axios,
    z: context.z,
    AsyncLocalStorage: context.AsyncLocalStorage,
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
    GuildModerationModel: context.GuildModerationModel,
    GuildSecurityModel: context.GuildSecurityModel,
    GuildYoutubeStateModel: context.GuildYoutubeStateModel,
    GuildAuditLogModel: context.GuildAuditLogModel,
    GuildConfigBackupModel: context.GuildConfigBackupModel,
    GuildSuggestedCommandModel: context.GuildSuggestedCommandModel,
    GuildYoutubeErrorModel: context.GuildYoutubeErrorModel,
    GuildDeadLetterModel: context.GuildDeadLetterModel,
    CircuitBreakerModel: context.CircuitBreakerModel,
    SystemModel: context.SystemModel,
    JobLockModel: context.JobLockModel,
    AdminAlertCooldownModel: context.AdminAlertCooldownModel,
    FetchSnapshotModel: context.FetchSnapshotModel,
    PlayerCountSnapshotModel: context.PlayerCountSnapshotModel,
    PlayerCountHistoryModel: context.PlayerCountHistoryModel,
    ReviewTrendSnapshotModel: context.ReviewTrendSnapshotModel,
    DealPriceSnapshotModel: context.DealPriceSnapshotModel,
    NewAccountAlertDeliveryModel: context.NewAccountAlertDeliveryModel,
    ChannelLockRecoveryModel: context.ChannelLockRecoveryModel,
    PlayerCountRecordModel: context.PlayerCountRecordModel,
    BugReportModel: context.BugReportModel,
    UserComplaintModel: context.UserComplaintModel,
    GuildSeenDiscountModel: context.GuildSeenDiscountModel,
    GuildSeenUpdateModel: context.GuildSeenUpdateModel,
    GuildSeenDlcModel: context.GuildSeenDlcModel,
    GuildSeenYoutubeModel: context.GuildSeenYoutubeModel,
    NotificationOutboxModel: context.NotificationOutboxModel,
    NotificationOutboxSentModel: context.NotificationOutboxSentModel,
    NotificationHistoryModel: context.NotificationHistoryModel,
    FeedbackReportModel: context.FeedbackReportModel,
    NotificationDeadLetterReplayModel: context.NotificationDeadLetterReplayModel,
    OperationJournalModel: context.OperationJournalModel,
    saveFetchSnapshot: context.saveFetchSnapshot,
    loadFetchSnapshot: context.loadFetchSnapshot,
    loadSourceHealth: context.loadSourceHealth,
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

function requireBootEnv(env: RuntimeEnv): RuntimeEnv & { MONGO_URI: string; DISCORD_TOKEN: string } {
  if (!env.MONGO_URI || !env.DISCORD_TOKEN) {
    throw new Error("mongoContext: MONGO_URI si DISCORD_TOKEN trebuie validate inainte de compunerea runtime-ului");
  }
  return { ...env, MONGO_URI: env.MONGO_URI, DISCORD_TOKEN: env.DISCORD_TOKEN };
}

function createMongoContext(): MongoRuntimeContext {
  const guildSettingsBus = createGuildSettingsEventBus();
  const base = { ...runtimeContextModule };
  const withLogging = { ...base, ...attachLoggingModule.buildFrom(base) };
  const withDomain = { ...withLogging, ...attachDomainModule.buildFrom({}) };
  const withEnv = { ...withDomain, ...attachEnvModule.buildFrom(withDomain) };
  const withUtilities = { ...withEnv, ...attachUtilitiesModule.buildFrom(withEnv), guildSettingsBus };
  const withModels = { ...withUtilities, ...attachModelsModule.buildFrom(withUtilities) };
  const withLocks = { ...withModels, ...attachLocksModule.buildFrom(withModels) };
  const withMigrations = { ...withLocks, ...attachMigrationsModule.buildFrom(withLocks) };
  const withSystemState = { ...withMigrations, ...attachSystemStateModule.buildFrom(withMigrations) };
  const withGuildSettings = { ...withSystemState, ...attachGuildSettingsModule.buildFrom(withSystemState) };
  const withAdminAlerts = { ...withGuildSettings, ...attachAdminAlertsModule.buildFrom(withGuildSettings) };
  const withFetchSnapshots = { ...withAdminAlerts, ...attachFetchSnapshotsModule.buildFrom(withAdminAlerts) };
  const withSourceHealth = { ...withFetchSnapshots, ...attachSourceHealthModule.buildFrom(withFetchSnapshots) };
  guildSettingsBus.setErrorReporter((guildId, error) => {
    withSourceHealth.logger("WARN", "GUILD_EVENTS", `Listener GuildSettingsChanged a esuat pentru guild ${guildId}`, error);
  });
  return assertNoUndefinedExports(buildMongoContextExports({ ...withSourceHealth, env: requireBootEnv(withSourceHealth.env) }), "mongoContext");
}

const mongoContext = Object.freeze({ ...createMongoContext(), createMongoContext });

export default mongoContext;
