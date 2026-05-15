"use strict";
// =============================================================
// db.js — V8
//   * LOG_LEVEL filtering (DEBUG/INFO/WARN/ERROR)
//   * Currency per-guild (USD/EUR/GBP/RON)
//   * SchemaDriftError pentru detectare drift HTML
//   * Magic numbers mutate în env vars
// =============================================================
const mongoose = require("mongoose");
const crypto = require("crypto");
const axios = require("axios");
const { z } = require("zod");

// -------------------------------------------------------------
// LOG_LEVEL (V8): filtrare la nivel de logger
// -------------------------------------------------------------
const LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const RAW_LOG_LEVEL = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const ACTIVE_LOG_LEVEL = LOG_LEVELS[RAW_LOG_LEVEL] ?? LOG_LEVELS.INFO;

const LOG_FORMAT = (process.env.LOG_FORMAT || "").toLowerCase();
const USE_JSON_LOGS = LOG_FORMAT === "json"
  || (LOG_FORMAT !== "text" && !process.stdout.isTTY);

function logger(level, context, message, meta = "") {
  const lvlKey = String(level || "INFO").toUpperCase();
  const lvl = LOG_LEVELS[lvlKey] ?? LOG_LEVELS.INFO;
  if (lvl < ACTIVE_LOG_LEVEL) return;

  const ts = new Date().toISOString();
  if (USE_JSON_LOGS) {
    const entry = { ts, level: lvlKey, context, message };
    if (meta !== "" && meta !== null && meta !== undefined) {
      if (meta instanceof Error) {
        entry.meta = { message: meta.message, stack: meta.stack };
      } else if (typeof meta === "string") {
        entry.meta = meta;
      } else {
        try { entry.meta = JSON.parse(JSON.stringify(meta)); }
        catch { entry.meta = String(meta); }
      }
    }
    let line;
    try { line = JSON.stringify(entry); }
    catch { line = JSON.stringify({ ts, level: lvlKey, context, message, meta: "[unserializable]" }); }
    if (lvlKey === "ERROR") console.error(line);
    else if (lvlKey === "WARN") console.warn(line);
    else console.log(line);
    return;
  }
  let metaStr = "";
  if (meta) {
    try { metaStr = typeof meta === "string" ? meta : JSON.stringify(meta); }
    catch { metaStr = String(meta); }
  }
  const line = `[${ts}] [${lvlKey}] [${context}] ${message} ${metaStr}`;
  if (lvlKey === "ERROR") console.error(line);
  else if (lvlKey === "WARN") console.warn(line);
  else console.log(line);
}

// -------------------------------------------------------------
// PARSE ENV NUMBER
// -------------------------------------------------------------
function parseEnvNumber(name, defaultValue, { min = 0, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    logger("WARN", "ENV", `${name}="${raw}" nu este număr valid, folosesc default ${defaultValue}`);
    return defaultValue;
  }
  if (parsed < min) {
    logger("WARN", "ENV", `${name}=${parsed} sub minimul ${min}, folosesc minimul`);
    return min;
  }
  if (parsed > max) {
    logger("WARN", "ENV", `${name}=${parsed} peste maximul ${max}, folosesc maximul`);
    return max;
  }
  return parsed;
}

// -------------------------------------------------------------
// SchemaDriftError — V8: distinct de network failure
// -------------------------------------------------------------
class SchemaDriftError extends Error {
  constructor(message, source) {
    super(message);
    this.name = "SchemaDriftError";
    this.code = "SCHEMA_DRIFT";
    this.source = source || "unknown";
  }
}

// -------------------------------------------------------------
// SUPPORTED_CURRENCIES — V8
// Steam returnează prețul real în valuta locală via cc, deci NU
// convertim noi prețuri (rate-urile sunt doar pentru sortare).
// -------------------------------------------------------------
const SUPPORTED_CURRENCIES = {
  USD: { cc: "US", symbol: "$",   placement: "prefix" },
  EUR: { cc: "DE", symbol: "€",   placement: "prefix" },
  GBP: { cc: "GB", symbol: "£",   placement: "prefix" },
  RON: { cc: "RO", symbol: " lei", placement: "suffix" }
};
const DEFAULT_CURRENCY = "USD";

function getCurrencyConfig(code) {
  return SUPPORTED_CURRENCIES[String(code || "").toUpperCase()] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];
}

function formatPrice(value, currencyCode) {
  const cfg = getCurrencyConfig(currencyCode);
  const num = Number(value);
  const formatted = Number.isFinite(num) ? num.toFixed(2) : String(value);
  return cfg.placement === "prefix"
    ? `${cfg.symbol}${formatted}`
    : `${formatted}${cfg.symbol}`;
}

// -------------------------------------------------------------
// VALIDARE ENV cu Zod
// -------------------------------------------------------------
const isProd = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  MONGO_URI: z.string().min(1, "MONGO_URI lipsește"),
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN lipsește"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID lipsește (necesar pentru slash commands)"),
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),
  METRICS_TOKEN: z.string().min(8, "METRICS_TOKEN trebuie să aibă cel puțin 8 caractere").optional(),
  METRICS_PUBLIC: z.string().optional(),
  ADMIN_WEBHOOK_URL: z.string().url("ADMIN_WEBHOOK_URL nu este URL valid").optional(),
  LOG_LEVEL: z.string().optional(),
  PROXY_URLS: z.string().optional()
}).superRefine((env, ctx) => {
  if (isProd) {
    const hasToken = !!env.METRICS_TOKEN;
    const explicitlyPublic = String(env.METRICS_PUBLIC || "").toLowerCase() === "true";
    if (!hasToken && !explicitlyPublic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "În NODE_ENV=production trebuie setat METRICS_TOKEN, SAU METRICS_PUBLIC=true (opt-in explicit)."
      });
    }
  }
});

try {
  EnvSchema.parse({
    MONGO_URI: process.env.MONGO_URI,
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    METRICS_TOKEN: process.env.METRICS_TOKEN,
    METRICS_PUBLIC: process.env.METRICS_PUBLIC,
    ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL,
    LOG_LEVEL: process.env.LOG_LEVEL,
    PROXY_URLS: process.env.PROXY_URLS
  });
} catch (err) {
  logger("ERROR", "ENV", "Validare variabile de mediu eșuată", err.issues || err.message);
  process.exit(1);
}

// -------------------------------------------------------------
// OBIECT env CENTRALIZAT
// -------------------------------------------------------------
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

const env = {
  MONGO_URI: process.env.MONGO_URI,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  PORT: process.env.PORT || "3000",
  NODE_ENV: process.env.NODE_ENV || "development",
  METRICS_TOKEN: process.env.METRICS_TOKEN || "",
  METRICS_PUBLIC: String(process.env.METRICS_PUBLIC || "").toLowerCase() === "true",
  ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL || "",
  LOG_LEVEL: RAW_LOG_LEVEL,
  PROXY_URLS: process.env.PROXY_URLS || "",

  FETCH_CONCURRENCY: parseEnvNumber("FETCH_CONCURRENCY", 10, { min: 1, max: 50 }),
  MAX_HTML_BYTES: parseEnvNumber("MAX_HTML_BYTES", 500_000, { min: 50_000, max: 50_000_000 }),
  MAX_JSON_BYTES: parseEnvNumber("MAX_JSON_BYTES", 5_000_000, { min: 100_000, max: 100_000_000 }),
  MAX_DEALS: parseEnvNumber("MAX_DEALS", 50, { min: 1, max: 500 }),
  STEAM_SPECIALS_LIMIT: parseEnvNumber("STEAM_SPECIALS_LIMIT", 30, { min: 1, max: 200 }),
  EPIC_SPECIALS_LIMIT: parseEnvNumber("EPIC_SPECIALS_LIMIT", 20, { min: 1, max: 200 }),
  STEAM_REVIEW_BATCH_SIZE: parseEnvNumber("STEAM_REVIEW_BATCH_SIZE", 5, { min: 1, max: 50 }),
  STEAM_REVIEW_BATCH_DELAY_MS: parseEnvNumber("STEAM_REVIEW_BATCH_DELAY_MS", 500, { min: 0, max: 60000 }),
  DISCORD_SEND_DELAY_MS: parseEnvNumber("DISCORD_SEND_DELAY_MS", 800, { min: 0, max: 60000 }),

  MAX_UPDATES_PER_CYCLE: parseEnvNumber("MAX_UPDATES_PER_CYCLE", 5, { min: 1, max: 100 }),
  MAX_DEALS_PER_CYCLE: parseEnvNumber("MAX_DEALS_PER_CYCLE", 8, { min: 1, max: 100 }),
  GUILD_PROCESS_CONCURRENCY: parseEnvNumber("GUILD_PROCESS_CONCURRENCY", 3, { min: 1, max: 50 }),

  SEEN_PER_GAME_LIMIT: parseEnvNumber("SEEN_PER_GAME_LIMIT", 20, { min: 5, max: 1000 }),
  DEALS_HISTORY_LIMIT: parseEnvNumber("DEALS_HISTORY_LIMIT", 300, { min: 50, max: 10000 }),
  PENDING_UPDATES_PER_GAME_LIMIT: parseEnvNumber("PENDING_UPDATES_PER_GAME_LIMIT", 5, { min: 1, max: 100 }),
  PENDING_DISCOUNTS_LIMIT: parseEnvNumber("PENDING_DISCOUNTS_LIMIT", 200, { min: 10, max: 10000 }),

  PENDING_UPDATE_MAX_AGE_MS: parseEnvNumber("PENDING_UPDATE_MAX_AGE_MS", ONE_DAY_MS, { min: 60_000, max: THIRTY_DAYS_MS }),
  PENDING_DISCOUNT_GRACE_CYCLES: parseEnvNumber("PENDING_DISCOUNT_GRACE_CYCLES", 3, { min: 1, max: 100 }),
  PENDING_UPDATE_MAX_ATTEMPTS: parseEnvNumber("PENDING_UPDATE_MAX_ATTEMPTS", 5, { min: 1, max: 100 }),
  PENDING_DISCOUNT_MAX_ATTEMPTS: parseEnvNumber("PENDING_DISCOUNT_MAX_ATTEMPTS", 10, { min: 1, max: 100 }),
  MAX_FUZZY_SEARCH_INPUT: parseEnvNumber("MAX_FUZZY_SEARCH_INPUT", 100, { min: 10, max: 500 }),

  INFLIGHT_PROMISE_TIMEOUT_MS: parseEnvNumber("INFLIGHT_PROMISE_TIMEOUT_MS", 120000, { min: 10000, max: 600000 }),
  USER_COMMAND_COOLDOWN_MS: parseEnvNumber("USER_COMMAND_COOLDOWN_MS", 10000, { min: 0, max: 300000 }),

  CIRCUIT_BREAKER_FAIL_THRESHOLD: parseEnvNumber("CIRCUIT_BREAKER_FAIL_THRESHOLD", 5, { min: 2, max: 100 }),
  CIRCUIT_BREAKER_COOLDOWN_MS: parseEnvNumber("CIRCUIT_BREAKER_COOLDOWN_MS", 45 * 60 * 1000, { min: 60_000, max: 12 * ONE_HOUR_MS }),
  CIRCUIT_BREAKER_JITTER_MS: parseEnvNumber("CIRCUIT_BREAKER_JITTER_MS", 15 * 60 * 1000, { min: 0, max: 2 * ONE_HOUR_MS }),
  SCHEMA_DRIFT_THRESHOLD: parseEnvNumber("SCHEMA_DRIFT_THRESHOLD", 3, { min: 1, max: 50 }),

  COLLECTOR_TIMEOUT_MS: parseEnvNumber("COLLECTOR_TIMEOUT_MS", 5 * 60 * 1000, { min: 30_000, max: ONE_HOUR_MS }),
  HOUSEKEEPING_INTERVAL_MS: parseEnvNumber("HOUSEKEEPING_INTERVAL_MS", 2 * 60 * 1000, { min: 30_000, max: ONE_HOUR_MS }),
  GUILD_CACHE_TTL_MS: parseEnvNumber("GUILD_CACHE_TTL_MS", 60_000, { min: 5_000, max: ONE_HOUR_MS }),
  ADMIN_ALERT_COOLDOWN_MS: parseEnvNumber("ADMIN_ALERT_COOLDOWN_MS", 30 * 60 * 1000, { min: 60_000, max: 24 * ONE_HOUR_MS }),
  SHUTDOWN_DRAIN_MS: parseEnvNumber("SHUTDOWN_DRAIN_MS", 2000, { min: 0, max: 30_000 }),

  ENRICHED_DEAL_CACHE_TTL_MS: parseEnvNumber("ENRICHED_DEAL_CACHE_TTL_MS", 10 * 60 * 1000, { min: 0, max: ONE_HOUR_MS }),
  ENRICHED_DEAL_CACHE_MAX_SIZE: parseEnvNumber("ENRICHED_DEAL_CACHE_MAX_SIZE", 500, { min: 0, max: 10_000 }),

  isProd
};

logger("INFO", "ENV", "Configurație de tuning încărcată", {
  LOG_LEVEL: env.LOG_LEVEL,
  FETCH_CONCURRENCY: env.FETCH_CONCURRENCY,
  GUILD_PROCESS_CONCURRENCY: env.GUILD_PROCESS_CONCURRENCY,
  DISCORD_SEND_DELAY_MS: env.DISCORD_SEND_DELAY_MS,
  MAX_UPDATES_PER_CYCLE: env.MAX_UPDATES_PER_CYCLE,
  MAX_DEALS_PER_CYCLE: env.MAX_DEALS_PER_CYCLE,
  SCHEMA_DRIFT_THRESHOLD: env.SCHEMA_DRIFT_THRESHOLD,
  ENRICHED_DEAL_CACHE_TTL_MS: env.ENRICHED_DEAL_CACHE_TTL_MS,
  PROXY_URLS_CONFIGURED: !!env.PROXY_URLS
});

// -------------------------------------------------------------
// runConcurrent
// -------------------------------------------------------------
async function runConcurrent(items, concurrency, fn, { shouldAbort = null, errorLogger = null } = {}) {
  if (!Array.isArray(items) || items.length === 0) return { processed: 0, errors: [] };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;
  let processed = 0;
  const errors = [];

  async function worker() {
    while (true) {
      if (shouldAbort && shouldAbort()) return;
      const myIndex = nextIndex++;
      if (myIndex >= items.length) return;
      try {
        await fn(items[myIndex], myIndex);
        processed++;
      } catch (err) {
        errors.push({ index: myIndex, item: items[myIndex], error: err });
        if (errorLogger) {
          try { errorLogger(items[myIndex], err); } catch { /* ignore */ }
        }
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return { processed, errors };
}

// -------------------------------------------------------------
// waitForMongoReady
// -------------------------------------------------------------
async function waitForMongoReady(timeoutMs = 10000) {
  if (mongoose.connection.readyState === 1) return true;
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      mongoose.connection.off("connected", onConnected);
      mongoose.connection.off("error", onError);
      clearTimeout(t);
    };
    const onConnected = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(true);
    };
    const onError = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(false);
    };
    const t = setTimeout(() => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(mongoose.connection.readyState === 1);
    }, timeoutMs);
    mongoose.connection.once("connected", onConnected);
    mongoose.connection.once("error", onError);
    if (mongoose.connection.readyState === 1 && !resolved) {
      resolved = true; cleanup(); resolve(true);
    }
  });
}

// -------------------------------------------------------------
// validatePendingDiscountSnapshot
// -------------------------------------------------------------
function validatePendingDiscountSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (typeof snapshot.title !== "string" || !snapshot.title) return false;
  if (typeof snapshot.store !== "string" || !snapshot.store) return false;
  if (typeof snapshot.link !== "string") return false;
  const sp = snapshot.salePrice;
  const np = snapshot.normalPrice;
  if (typeof sp !== "string" && typeof sp !== "number") return false;
  if (typeof np !== "string" && typeof np !== "number") return false;
  if (typeof snapshot.savings !== "number" || !Number.isFinite(snapshot.savings)) return false;
  return true;
}

// -------------------------------------------------------------
// SCHEME MONGOOSE
// -------------------------------------------------------------
const pendingUpdateSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, default: "" },
  link: { type: String, default: "" },
  excerpt: { type: String, default: "" },
  thumbnail: { type: String, default: null },
  image: { type: String, default: null },
  timestamp: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 }
}, { _id: false });

const pendingDiscountSchema = new mongoose.Schema({
  hash: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  lastSeenAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 }
}, { _id: false });

const guildSchema = new mongoose.Schema({
  _id: String,
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: Map, of: [String], default: {} },
  pendingUpdates: { type: Map, of: [pendingUpdateSchema], default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: [String], default: [] },
  pendingDiscounts: { type: [pendingDiscountSchema], default: [] },
  minDiscountPercent: { type: Number, default: 70 },
  includeFreeGames: { type: Boolean, default: true },
  includePaidDiscounts: { type: Boolean, default: true },
  notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" },
  // V8: currency per-guild
  currency: { type: String, enum: Object.keys(SUPPORTED_CURRENCIES), default: DEFAULT_CURRENCY },
  // V8: offset round-robin pentru fairness
  lastProcessedGameKey: { type: String, default: null }
}, { minimize: false });

guildSchema.index({ subscribed: 1, notificationChannelId: 1 }, { background: true });
guildSchema.index({ discountsSubscribed: 1, discountChannelId: 1 }, { background: true });

const GuildModel = mongoose.model("Guild", guildSchema);

const circuitBreakerSchema = new mongoose.Schema({
  _id: String,
  fails: { type: Number, default: 0 },
  cooldownUntil: { type: Date, default: null },
  alertSent: { type: Boolean, default: false },
  // V8: schema drift = HTTP 200 dar 0 rezultate (selectori CSS rupte)
  schemaDriftFails: { type: Number, default: 0 },
  schemaDriftAlertSent: { type: Boolean, default: false }
}, { minimize: false });
const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: {
    all: { type: Number, default: 35000 },
    single: { type: Number, default: 2000 },
    reduceri: { type: Number, default: 10000 }
  }
}, { minimize: false });
const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({
  _id: String,
  lockedUntil: { type: Date, default: null, index: true },
  ownerToken: { type: String, default: null }
}, { minimize: false });
const JobLockModel = mongoose.model("JobLock", jobLockSchema);

// -------------------------------------------------------------
// LOCK-URI DISTRIBUITE
// -------------------------------------------------------------
const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const lockToken = crypto.randomUUID();
  try {
    const lock = await JobLockModel.findOneAndUpdate(
      { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { lockedUntil: expires, ownerToken: lockToken } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }
    return null;
  } catch (err) {
    if (err.code === 11000) return null;
    logger("WARN", "DB_LOCK", "Eroare la obținerea lock-ului", err.message);
    return null;
  }
}

async function renewDbLock(jobName, token, ttlMs = 120000) {
  if (!token) return false;
  const expires = new Date(Date.now() + ttlMs);
  try {
    const res = await JobLockModel.updateOne(
      { _id: `lock_${jobName}`, ownerToken: token },
      { $set: { lockedUntil: expires } }
    );
    return res.modifiedCount > 0;
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la reînnoire lock", err.message);
    return false;
  }
}

async function releaseDbLock(jobName, token) {
  if (!token) return;
  try {
    await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
    activeLocks.delete(jobName);
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la eliberare lock", err.message);
  }
}

// -------------------------------------------------------------
// SYSTEM TIMES
// -------------------------------------------------------------
async function getSystemTimes() {
  const sys = await SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: { all: 35000, single: 2000, reduceri: 10000 } } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return sys.executionTimes || { all: 35000, single: 2000, reduceri: 10000 };
}

async function saveSystemTimes(times) {
  await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

// -------------------------------------------------------------
// GUILD SETTINGS CACHE
// -------------------------------------------------------------
const GUILD_CACHE_TTL_MS = env.GUILD_CACHE_TTL_MS;
const guildSettingsCache = new Map();

async function getGuildSettings(guildId) {
  const now = Date.now();
  const cached = guildSettingsCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.data;
  const fresh = await GuildModel.findById(guildId).lean();
  guildSettingsCache.set(guildId, { data: fresh, expiresAt: now + GUILD_CACHE_TTL_MS });
  return fresh;
}

function invalidateGuildCache(guildId) {
  guildSettingsCache.delete(guildId);
}

function cleanGuildCache() {
  const now = Date.now();
  for (const [key, value] of guildSettingsCache.entries()) {
    if (value.expiresAt < now) guildSettingsCache.delete(key);
  }
}

function getGuildCacheSize() {
  return guildSettingsCache.size;
}

// -------------------------------------------------------------
// ADMIN ALERTS
// -------------------------------------------------------------
const ADMIN_ALERT_COOLDOWN_MS = env.ADMIN_ALERT_COOLDOWN_MS;
const lastAdminAlertAt = new Map();

async function adminAlert(kind, title, body) {
  const url = env.ADMIN_WEBHOOK_URL;
  if (!url) return;
  const now = Date.now();
  const lastAt = lastAdminAlertAt.get(kind) || 0;
  if (now - lastAt < ADMIN_ALERT_COOLDOWN_MS) return;
  lastAdminAlertAt.set(kind, now);

  const payload = {
    embeds: [{
      title: `\u26A0\uFE0F ${title}`,
      description: String(body || "").slice(0, 3500),
      color: 0xe74c3c,
      timestamp: new Date().toISOString(),
      footer: { text: `kind=${kind}` }
    }]
  };
  try {
    await axios.post(url, payload, { timeout: 5000 });
    logger("INFO", "ADMIN_ALERT", `Alertă trimisă: ${kind} - ${title}`);
  } catch (err) {
    logger("WARN", "ADMIN_ALERT", "Nu am putut trimite webhook admin", err.message);
  }
}

module.exports = {
  logger,
  env,
  parseEnvNumber,
  runConcurrent,
  waitForMongoReady,
  validatePendingDiscountSnapshot,
  GuildModel,
  CircuitBreakerModel,
  SystemModel,
  JobLockModel,
  acquireDbLock,
  renewDbLock,
  releaseDbLock,
  activeLocks,
  getSystemTimes,
  saveSystemTimes,
  getGuildSettings,
  invalidateGuildCache,
  cleanGuildCache,
  getGuildCacheSize,
  adminAlert,
  SchemaDriftError,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  getCurrencyConfig,
  formatPrice
};
