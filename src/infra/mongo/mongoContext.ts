"use strict";

type MongoRuntimeContext = Record<string, any>;
type MongoInstaller = (ctx: MongoRuntimeContext) => void;

const runtimeCtx = require("./runtime") as MongoRuntimeContext;
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
  require("./adminAlerts")
];

function buildMongoContextExports(ctx: MongoRuntimeContext) {
  return {
    logger: ctx.logger,
    env: ctx.env,
    parseEnvNumber: ctx.parseEnvNumber,
    runConcurrent: ctx.runConcurrent,
    waitForMongoReady: ctx.waitForMongoReady,
    validatePendingDiscountSnapshot: ctx.validatePendingDiscountSnapshot,
    isTransientMongoError: ctx.isTransientMongoError,
    withMongoRetry: ctx.withMongoRetry,
    GuildModel: ctx.GuildModel,
    CircuitBreakerModel: ctx.CircuitBreakerModel,
    SystemModel: ctx.SystemModel,
    JobLockModel: ctx.JobLockModel,
    AdminAlertCooldownModel: ctx.AdminAlertCooldownModel,
    acquireDbLock: ctx.acquireDbLock,
    renewDbLock: ctx.renewDbLock,
    releaseDbLock: ctx.releaseDbLock,
    activeLocks: ctx.activeLocks,
    runMigrations: ctx.runMigrations,
    ALL_MIGRATIONS: ctx.ALL_MIGRATIONS,
    getSystemTimes: ctx.getSystemTimes,
    saveSystemTimes: ctx.saveSystemTimes,
    saveSystemTime: ctx.saveSystemTime,
    getGuildSettings: ctx.getGuildSettings,
    invalidateGuildCache: ctx.invalidateGuildCache,
    cleanGuildCache: ctx.cleanGuildCache,
    getGuildCacheSize: ctx.getGuildCacheSize,
    adminAlert: ctx.adminAlert,
    SchemaDriftError: ctx.SchemaDriftError,
    SUPPORTED_CURRENCIES: ctx.SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY: ctx.DEFAULT_CURRENCY,
    getCurrencyConfig: ctx.getCurrencyConfig,
    formatPrice: ctx.formatPrice,
    requestContext: ctx.requestContext,
    getAbortSignal: ctx.getAbortSignal
  };
}

function createMongoContext(
  baseContext: MongoRuntimeContext = runtimeCtx,
  installers: MongoInstaller[] = defaultInstallers
) {
  const ctx = baseContext;
  for (const install of installers) install(ctx);
  return buildMongoContextExports(ctx);
}

const mongoContext = createMongoContext();

Object.assign(module.exports, mongoContext, { createMongoContext });

export {};
