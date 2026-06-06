"use strict";

import { assertNoUndefinedExports } from "../../shared/assertCompleteExports";

type MongoRuntimeContext = Record<string, unknown>;
type MongoInstaller = (target: MongoRuntimeContext) => void;

type MongoContextExportKey =
  | "logger" | "env" | "parseEnvNumber" | "runConcurrent" | "waitForMongoReady"
  | "validatePendingDiscountSnapshot" | "isTransientMongoError" | "withMongoRetry"
  | "GuildModel" | "CircuitBreakerModel" | "SystemModel" | "JobLockModel"
  | "AdminAlertCooldownModel" | "FetchSnapshotModel" | "GuildSeenDiscountModel"
  | "GuildSeenUpdateModel" | "NotificationOutboxModel" | "NotificationOutboxSentModel"
  | "NotificationHistoryModel"
  | "saveFetchSnapshot" | "loadFetchSnapshot" | "loadDealsFetchSnapshots"
  | "acquireDbLock" | "renewDbLock" | "releaseDbLock" | "activeLocks"
  | "runMigrations" | "ALL_MIGRATIONS" | "getSystemTimes" | "saveSystemTimes"
  | "saveSystemTime" | "getOutboxPaused" | "setOutboxPaused" | "getGuildSettings"
  | "invalidateGuildCache" | "cleanGuildCache" | "getGuildCacheSize" | "adminAlert"
  | "SchemaDriftError" | "SUPPORTED_CURRENCIES" | "DEFAULT_CURRENCY" | "getCurrencyConfig"
  | "formatPrice" | "requestContext" | "getAbortSignal";

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

function buildMongoContextExports(context: MongoRuntimeContext): Record<MongoContextExportKey, unknown> {
  return {
    logger: context.logger,
    env: context.env,
    parseEnvNumber: context.parseEnvNumber,
    runConcurrent: context.runConcurrent,
    waitForMongoReady: context.waitForMongoReady,
    validatePendingDiscountSnapshot: context.validatePendingDiscountSnapshot,
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
    NotificationOutboxModel: context.NotificationOutboxModel,
    NotificationOutboxSentModel: context.NotificationOutboxSentModel,
    NotificationHistoryModel: context.NotificationHistoryModel,
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
