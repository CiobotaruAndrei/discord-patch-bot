"use strict";
// =============================================================
// db.js — bootstrap module:
//   * validare env cu Zod (inclusiv variabile de tuning)
//   * helper parseEnvNumber care suportă corect valoarea 0
//   * modele Mongoose, lock-uri distribuite, guild settings cache,
//     alertare admin (Discord webhook opțional), indexuri pentru cron.
// =============================================================
const mongoose = require("mongoose");
const crypto = require("crypto");
const axios = require("axios");
const { z } = require("zod");
// -------------------------------------------------------------
// LOGGER
// -------------------------------------------------------------
function logger(level, context, message, meta = "") {
  const ts = new Date().toISOString();
  let metaStr = "";
  if (meta) {
    try { metaStr = typeof meta === "string" ? meta : JSON.stringify(meta); }
    catch { metaStr = String(meta); }
  }
  const line = `[${ts}] [${level}] [${context}] ${message} ${metaStr}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}
// -------------------------------------------------------------
// PARSE ENV NUMBER — fix bug logic pentru valoarea 0
//
// Bug-ul vechi: `Math.max(0, Number(process.env.X) || 800)` — dacă
// utilizatorul setează `X=0`, `Number("0")` e `0`, `0 || 800` e `800`.
// Deci 0 nu putea fi setat niciodată, deși codul părea să-l permită.
//
// Helper-ul ăsta:
//   * Acceptă explicit 0 dacă min permite
//   * Validează că e număr finit (NaN, Infinity → default)
//   * Aplică min/max ca clamp, dar respectă valori explicit valide
// -------------------------------------------------------------
function parseEnvNumber(name, defaultValue, { min = 0, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    logger("WARN", "ENV", `${name}="${raw}" nu este număr valid, folosesc default
${defaultValue}`);
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
// VALIDARE ENV cu Zod
// Toate variabilele booleene/string sunt validate aici.
// Variabilele numerice sunt validate prin parseEnvNumber (suportă 0)
// și expuse mai jos în obiectul `env`.
// -------------------------------------------------------------
const isProd = process.env.NODE_ENV === "production";
const EnvSchema = z.object({
  MONGO_URI: z.string().min(1, "MONGO_URI lipsește"),
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN lipsește"),
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),
  METRICS_TOKEN: z.string().min(8, "METRICS_TOKEN trebuie să aibă cel puțin 8
caractere").optional(),
  METRICS_PUBLIC: z.string().optional(),
  ADMIN_WEBHOOK_URL: z.string().url("ADMIN_WEBHOOK_URL nu este URL valid").optional()
}).superRefine((env, ctx) => {
  if (isProd) {
    const hasToken = !!env.METRICS_TOKEN;
    const explicitlyPublic = String(env.METRICS_PUBLIC || "").toLowerCase() === "true";
    if (!hasToken && !explicitlyPublic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "În NODE_ENV=production trebuie setat METRICS_TOKEN, SAU METRICS_PUBLIC=true
(opt-in explicit)."
      });
    }
  }
});
try {
  EnvSchema.parse({
    MONGO_URI: process.env.MONGO_URI,
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    METRICS_TOKEN: process.env.METRICS_TOKEN,
    METRICS_PUBLIC: process.env.METRICS_PUBLIC,
    ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL
  });
} catch (err) {
  logger("ERROR", "ENV", "Validare variabile de mediu eșuată", err.issues || err.message);
  process.exit(1);
}
// -------------------------------------------------------------
// OBIECT env CENTRALIZAT — sursă unică de adevăr pentru toate
// variabilele de tuning. Restul modulelor importă din acest obiect.
// -------------------------------------------------------------
const env = {
  // Variabile string/bool — validate de Zod mai sus
  MONGO_URI: process.env.MONGO_URI,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  PORT: process.env.PORT || "3000",
  NODE_ENV: process.env.NODE_ENV || "development",
  METRICS_TOKEN: process.env.METRICS_TOKEN || "",
  METRICS_PUBLIC: String(process.env.METRICS_PUBLIC || "").toLowerCase() === "true",
  ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL || "",
  // Variabile numerice — validate prin parseEnvNumber (suportă 0 corect)
  FETCH_CONCURRENCY: parseEnvNumber("FETCH_CONCURRENCY", 10, { min: 1, max: 50 }),
  MAX_HTML_BYTES: parseEnvNumber("MAX_HTML_BYTES", 500_000, { min: 50_000, max: 50_000_000 }),
  // NOU: limită separată pentru API-uri JSON (Steam appdetails poate ajunge >1MB)
  MAX_JSON_BYTES: parseEnvNumber("MAX_JSON_BYTES", 5_000_000, { min: 100_000, max: 100_000_000
}),
  MAX_DEALS: parseEnvNumber("MAX_DEALS", 50, { min: 1, max: 500 }),
  STEAM_SPECIALS_LIMIT: parseEnvNumber("STEAM_SPECIALS_LIMIT", 30, { min: 1, max: 200 }),
  EPIC_SPECIALS_LIMIT: parseEnvNumber("EPIC_SPECIALS_LIMIT", 20, { min: 1, max: 200 }),
  STEAM_REVIEW_BATCH_SIZE: parseEnvNumber("STEAM_REVIEW_BATCH_SIZE", 5, { min: 1, max: 50 }),
  // ACEȘTI delays pot fi 0 dacă cineva chiar vrea (testing, sau rate-limit deja gestionat
altundeva)
  STEAM_REVIEW_BATCH_DELAY_MS: parseEnvNumber("STEAM_REVIEW_BATCH_DELAY_MS", 500, { min: 0, max:
60000 }),
  DISCORD_SEND_DELAY_MS: parseEnvNumber("DISCORD_SEND_DELAY_MS", 800, { min: 0, max: 60000 }),
  // Cron-related
  MAX_UPDATES_PER_CYCLE: parseEnvNumber("MAX_UPDATES_PER_CYCLE", 5, { min: 1, max: 100 }),
  MAX_DEALS_PER_CYCLE: parseEnvNumber("MAX_DEALS_PER_CYCLE", 8, { min: 1, max: 100 }),
  GUILD_PROCESS_CONCURRENCY: parseEnvNumber("GUILD_PROCESS_CONCURRENCY", 3, { min: 1, max: 50
}),
  // Pending state limits
  SEEN_PER_GAME_LIMIT: parseEnvNumber("SEEN_PER_GAME_LIMIT", 20, { min: 5, max: 1000 }),
  DEALS_HISTORY_LIMIT: parseEnvNumber("DEALS_HISTORY_LIMIT", 300, { min: 50, max: 10000 }),
  PENDING_UPDATES_PER_GAME_LIMIT: parseEnvNumber("PENDING_UPDATES_PER_GAME_LIMIT", 5, { min: 1,
max: 100 }),
  PENDING_DISCOUNTS_LIMIT: parseEnvNumber("PENDING_DISCOUNTS_LIMIT", 200, { min: 10, max: 10000
}),
  PENDING_UPDATE_MAX_AGE_MS: parseEnvNumber("PENDING_UPDATE_MAX_AGE_MS", 24 * 60 * 60 * 1000, {
min: 60_000 }),
  PENDING_DISCOUNT_GRACE_CYCLES: parseEnvNumber("PENDING_DISCOUNT_GRACE_CYCLES", 3, { min: 1,
max: 100 }),
  PENDING_UPDATE_MAX_ATTEMPTS: parseEnvNumber("PENDING_UPDATE_MAX_ATTEMPTS", 5, { min: 1, max:
100 }),
  isProd
};
// Log valorile finale ale env-ului numeric pentru debug pornire
logger("INFO", "ENV", "Configurație de tuning încărcată", {
  FETCH_CONCURRENCY: env.FETCH_CONCURRENCY,
  MAX_HTML_BYTES: env.MAX_HTML_BYTES,
  MAX_JSON_BYTES: env.MAX_JSON_BYTES,
  GUILD_PROCESS_CONCURRENCY: env.GUILD_PROCESS_CONCURRENCY,
  DISCORD_SEND_DELAY_MS: env.DISCORD_SEND_DELAY_MS,
  MAX_UPDATES_PER_CYCLE: env.MAX_UPDATES_PER_CYCLE,
  MAX_DEALS_PER_CYCLE: env.MAX_DEALS_PER_CYCLE
});
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
  notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" }
}, { minimize: false });
guildSchema.index({ subscribed: 1, notificationChannelId: 1 }, { background: true });
guildSchema.index({ discountsSubscribed: 1, discountChannelId: 1 }, { background: true });
const GuildModel = mongoose.model("Guild", guildSchema);
const circuitBreakerSchema = new mongoose.Schema({
  _id: String,
  fails: { type: Number, default: 0 },
  cooldownUntil: { type: Date, default: null },
  alertSent: { type: Boolean, default: false }
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
      { new: true }
    );
    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }
    try {
      await JobLockModel.create({ _id: `lock_${jobName}`, lockedUntil: expires, ownerToken:
lockToken });
      activeLocks.set(jobName, lockToken);
      return lockToken;
    } catch (createErr) {
      if (createErr.code === 11000) return null;
      throw createErr;
    }
  } catch (err) {
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
  await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, {
upsert: true });
}
// -------------------------------------------------------------
// GUILD SETTINGS CACHE
// -------------------------------------------------------------
const GUILD_CACHE_TTL_MS = 60000;
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
const ADMIN_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
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
  adminAlert
};
