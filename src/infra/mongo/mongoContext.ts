"use strict";

const ctx = require("./runtime");

require("../../shared/logging")(ctx);
require("../../shared/domain")(ctx);
require("../../shared/env")(ctx);
require("../../shared/utilities")(ctx);
require("./models")(ctx);
require("./locks")(ctx);
require("./migrations")(ctx);
require("./systemState")(ctx);
require("./guildSettings")(ctx);
require("./adminAlerts")(ctx);

module.exports = {
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

export {};
