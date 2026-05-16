"use strict";
// =============================================================
// index.js — V9
//   * V8 features păstrate: slash commands, housekeeping, drain
//   * Rate limiting per IP pe HTTP server (token bucket /health & /metrics)
//   * mongoose.connect cu maxPoolSize din env.MONGO_MAX_POOL_SIZE
//   * interactionCreate wrap în requestContext.run pentru req_id propagat
//   * SHUTDOWN_DRAIN_MS default acum 5000 (din db.js)
// =============================================================
const mongoose = require("mongoose");
const http = require("http");
const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { Client, GatewayIntentBits } = require("discord.js");
const { validateConfig } = require("./configValidator");

// -------------------------------------------------------------
// CONFIG LOADING
// -------------------------------------------------------------
const CONFIG_PATH = process.env.CONFIG_PATH || "./config.json";
let config;
try {
  config = require(CONFIG_PATH);
} catch (err) {
  console.error(`[BOOT] Nu pot încărca config-ul de la calea "${CONFIG_PATH}": ${err.message}`);
  console.error("[BOOT] Asigură-te că fișierul există și este JSON valid. Override cu env CONFIG_PATH.");
  process.exit(1);
}
try {
  config = validateConfig(config, CONFIG_PATH);
} catch (err) {
  console.error(`[BOOT] ${err.message}`);
  process.exit(1);
}
const games = Array.isArray(config.games) ? config.games : [];
if (games.length === 0) {
  console.error(`[BOOT] Config-ul de la "${CONFIG_PATH}" nu conține un array "games" cu jocuri.`);
  process.exit(1);
}

const {
  logger, env, parseEnvNumber,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  waitForMongoReady, cleanGuildCache, getGuildCacheSize, adminAlert,
  requestContext
} = require("./db");
const commands = require("./commands");
const scrapers = require("./scrapers");

// -------------------------------------------------------------
// CONFIG CRON
// -------------------------------------------------------------
const ALLOWED_CRON_INTERVALS = new Set([
  10 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000
]);
const CONFIG_INTERVAL_MS = Number.isFinite(config.checkIntervalMinutes) && config.checkIntervalMinutes > 0
  ? Math.round(config.checkIntervalMinutes * 60 * 1000)
  : 30 * 60 * 1000;
const DEFAULT_CRON_INTERVAL_MS = CONFIG_INTERVAL_MS;
const REQUESTED_CRON_INTERVAL_MS = parseEnvNumber(
  "CRON_INTERVAL_MS",
  DEFAULT_CRON_INTERVAL_MS,
  { min: 10 * 60 * 1000, max: 60 * 60 * 1000 }
);
const CRON_INTERVAL_MS = ALLOWED_CRON_INTERVALS.has(REQUESTED_CRON_INTERVAL_MS)
  ? REQUESTED_CRON_INTERVAL_MS
  : DEFAULT_CRON_INTERVAL_MS;
if (REQUESTED_CRON_INTERVAL_MS !== CRON_INTERVAL_MS) {
  logger("WARN", "CONFIG",
    `CRON_INTERVAL_MS=${REQUESTED_CRON_INTERVAL_MS} nu este într-o valoare suportată ` +
    `(10/15/30/60 min). Folosesc default ${DEFAULT_CRON_INTERVAL_MS}.`);
}

const CRON_LOCK_TTL_MS = Math.max(CRON_INTERVAL_MS + 60_000, 5 * 60 * 1000);
const HEARTBEAT_INTERVAL_MS = Math.max(15_000, Math.floor(CRON_LOCK_TTL_MS / 3));

commands.setGlobalCacheTtl(Math.min(30 * 60 * 1000, CRON_INTERVAL_MS));

// -------------------------------------------------------------
// METRICI
// -------------------------------------------------------------
const metrics = {
  fetchSuccess: 0,
  fetchFail: 0,
  httpRetries: 0,
  rateLimitHits: 0,
  cronRuns: 0,
  cronErrors: 0,
  cronSkippedDueToLock: 0,
  cronAborted: 0,
  httpRateLimitDrops: 0,
  startedAt: Date.now()
};
scrapers.attachMetrics(metrics);

// -------------------------------------------------------------
// DISCORD CLIENT
// -------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// -------------------------------------------------------------
// CRON STATE
// -------------------------------------------------------------
let cronTimerId = null;
let heartbeatTimerId = null;
let isShuttingDown = false;
let currentCronAbortController = null;
let currentCronToken = null;

function shouldAbortCron() {
  return isShuttingDown || (currentCronAbortController?.signal.aborted ?? false);
}

async function runCronCycle() {
  if (isShuttingDown) return;
  if (mongoose.connection.readyState !== 1) {
    logger("WARN", "CRON", "Mongo nu e conectat, sar peste ciclul curent");
    scheduleNextCron();
    return;
  }
  if (!client.isReady()) {
    logger("WARN", "CRON", "Discord client nu e ready, sar peste ciclu");
    scheduleNextCron();
    return;
  }

  const lockToken = await acquireDbLock("cron_main", CRON_LOCK_TTL_MS);
  if (!lockToken) {
    metrics.cronSkippedDueToLock++;
    logger("INFO", "CRON", "Lock cron deținut de altă instanță, sar peste ciclu");
    scheduleNextCron();
    return;
  }
  currentCronToken = lockToken;
  currentCronAbortController = new AbortController();

  startHeartbeat(lockToken);

  metrics.cronRuns++;
  const cycleStart = performance.now();
  // V9: requestContext.run propagă req_id-ul pe toate awaiterele crontului.
  // Pentru cron folosim un prefix dedicat ca să distingem ușor în logs.
  const cronReqId = `cron-${metrics.cronRuns}-${crypto.randomBytes(3).toString("hex")}`;
  await requestContext.run({ requestId: cronReqId }, async () => {
    try {
      logger("INFO", "CRON", `Pornire ciclu cron #${metrics.cronRuns}`);
      await Promise.all([
        commands.checkForUpdates(client, games, shouldAbortCron),
        commands.checkForDiscounts(client, shouldAbortCron)
      ]);
      if (currentCronAbortController.signal.aborted) {
        metrics.cronAborted++;
        logger("WARN", "CRON", "Ciclu abandonat (shutdown sau abort)");
      } else {
        const ms = Math.round(performance.now() - cycleStart);
        logger("INFO", "CRON", `Ciclu cron #${metrics.cronRuns} finalizat în ${ms}ms`);
      }
    } catch (err) {
      metrics.cronErrors++;
      logger("ERROR", "CRON", `Eroare în ciclul cron #${metrics.cronRuns}`, err.stack || err.message);
      adminAlert("cron:fatal", `Eroare cron ciclu #${metrics.cronRuns}`, err.message).catch(() => null);
    } finally {
      stopHeartbeat();
      await releaseDbLock("cron_main", lockToken).catch(() => null);
      currentCronToken = null;
      currentCronAbortController = null;
      if (!isShuttingDown) scheduleNextCron();
    }
  });
}

function scheduleNextCron() {
  if (isShuttingDown) return;
  if (cronTimerId) clearTimeout(cronTimerId);
  cronTimerId = setTimeout(runCronCycle, CRON_INTERVAL_MS);
  if (typeof cronTimerId.unref === "function") cronTimerId.unref();
}

function startHeartbeat(lockToken) {
  stopHeartbeat();
  const tick = async () => {
    if (isShuttingDown || currentCronToken !== lockToken) return;
    try {
      const renewed = await renewDbLock("cron_main", lockToken, CRON_LOCK_TTL_MS);
      if (!renewed) {
        logger("WARN", "CRON_HEARTBEAT", "Lock-ul cron nu a putut fi reînnoit, anulez ciclul");
        if (currentCronAbortController) currentCronAbortController.abort();
        return;
      }
    } catch (err) {
      logger("WARN", "CRON_HEARTBEAT", "Eroare la reînnoirea lock-ului", err.message);
    }
    if (!isShuttingDown && currentCronToken === lockToken) {
      heartbeatTimerId = setTimeout(tick, HEARTBEAT_INTERVAL_MS);
      if (typeof heartbeatTimerId.unref === "function") heartbeatTimerId.unref();
    }
  };
  heartbeatTimerId = setTimeout(tick, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimerId.unref === "function") heartbeatTimerId.unref();
}

function stopHeartbeat() {
  if (heartbeatTimerId) {
    clearTimeout(heartbeatTimerId);
    heartbeatTimerId = null;
  }
}

// -------------------------------------------------------------
// HOUSEKEEPING
// -------------------------------------------------------------
let housekeepingTimerId = null;

function startHousekeeping() {
  const tick = () => {
    try { commands.cleanCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanCache eroare", e.message); }
    try { cleanGuildCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanGuildCache eroare", e.message); }
    try { scrapers.cleanEnrichedCache(); } catch (e) { logger("WARN", "HOUSEKEEPING", "cleanEnrichedCache eroare", e.message); }
    try { pruneRateLimitMap(); } catch (e) { logger("WARN", "HOUSEKEEPING", "pruneRateLimitMap eroare", e.message); }
  };
  housekeepingTimerId = setInterval(tick, env.HOUSEKEEPING_INTERVAL_MS);
  if (typeof housekeepingTimerId.unref === "function") housekeepingTimerId.unref();
  logger("INFO", "HOUSEKEEPING", `Pornit interval=${env.HOUSEKEEPING_INTERVAL_MS}ms`);
}

function stopHousekeeping() {
  if (housekeepingTimerId) {
    clearInterval(housekeepingTimerId);
    housekeepingTimerId = null;
  }
}

// -------------------------------------------------------------
// V9: RATE LIMITING PER IP (token bucket per IP)
// Map: clientIp -> { tokens, lastRefill }
// La fiecare cerere refacem token-uri proporțional cu timpul scurs.
// La 1000 entry-uri facem o curățare proactivă (în plus față de cea
// din housekeeping) ca să nu lăsăm Map-ul să crească necontrolat.
// -------------------------------------------------------------
const RL_CAP = env.HTTP_RATE_LIMIT_REQ;
const RL_WINDOW_MS = env.HTTP_RATE_LIMIT_WINDOW_MS;
const RL_REFILL_PER_MS = RL_CAP / RL_WINDOW_MS;
const RL_MAP_MAX = 1000;
const rateLimitMap = new Map();

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function checkHttpRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { tokens: RL_CAP, lastRefill: now };
    rateLimitMap.set(ip, entry);
  } else {
    const elapsed = now - entry.lastRefill;
    if (elapsed > 0) {
      entry.tokens = Math.min(RL_CAP, entry.tokens + elapsed * RL_REFILL_PER_MS);
      entry.lastRefill = now;
    }
    // LRU touch
    rateLimitMap.delete(ip);
    rateLimitMap.set(ip, entry);
  }
  if (rateLimitMap.size > RL_MAP_MAX) {
    pruneRateLimitMap();
  }
  if (entry.tokens < 1) {
    metrics.httpRateLimitDrops++;
    return false;
  }
  entry.tokens -= 1;
  return true;
}

function pruneRateLimitMap() {
  const now = Date.now();
  // Entry-uri "pline" și vechi (mai vechi decât 2x fereastra) pot fi șterse —
  // sunt clienți inactivi care nu mai consumă oricum.
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.lastRefill > RL_WINDOW_MS * 2 && entry.tokens >= RL_CAP * 0.95) {
      rateLimitMap.delete(ip);
    }
  }
  // Dacă tot e prea plin, eliminăm cei mai vechi (LRU)
  if (rateLimitMap.size > RL_MAP_MAX) {
    const excess = rateLimitMap.size - RL_MAP_MAX;
    let deleted = 0;
    for (const key of rateLimitMap.keys()) {
      rateLimitMap.delete(key);
      if (++deleted >= excess) break;
    }
  }
}

// -------------------------------------------------------------
// HTTP SERVER — health + metrics
// -------------------------------------------------------------
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  try { return crypto.timingSafeEqual(bufA, bufB); } catch { return false; }
}

function checkMetricsAuth(req) {
  if (!env.isProd && !env.METRICS_TOKEN) return true;
  if (env.METRICS_PUBLIC && !env.METRICS_TOKEN) return true;
  if (!env.METRICS_TOKEN) return false;
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${env.METRICS_TOKEN}`;
  return timingSafeEqualStr(auth, expected);
}

const httpServer = http.createServer((req, res) => {
  // V9: rate limit pe ambele endpoint-uri publice. 429 cu Retry-After.
  if (req.url === "/health" || req.url === "/healthz" || req.url === "/metrics") {
    if (!checkHttpRateLimit(req)) {
      res.writeHead(429, {
        "Content-Type": "text/plain",
        "Retry-After": Math.ceil(RL_WINDOW_MS / 1000).toString()
      });
      res.end("Too Many Requests");
      return;
    }
  }

  if (req.url === "/health" || req.url === "/healthz") {
    const ok = mongoose.connection.readyState === 1 && client.isReady();
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: ok ? "ok" : "degraded",
      mongo: mongoose.connection.readyState,
      discord: client.isReady() ? "ready" : "not-ready",
      uptimeMs: Date.now() - metrics.startedAt
    }));
    return;
  }
  if (req.url === "/metrics") {
    if (!checkMetricsAuth(req)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized");
      return;
    }
    const cacheSizes = commands.getCacheSizes();
    const lines = [
      `# HELP bot_uptime_seconds Bot uptime`,
      `# TYPE bot_uptime_seconds gauge`,
      `bot_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
      `# HELP bot_fetch_success Fetch reușite`,
      `# TYPE bot_fetch_success counter`,
      `bot_fetch_success ${metrics.fetchSuccess}`,
      `# HELP bot_fetch_fail Fetch eșuate`,
      `# TYPE bot_fetch_fail counter`,
      `bot_fetch_fail ${metrics.fetchFail}`,
      `# HELP bot_http_retries HTTP retries`,
      `# TYPE bot_http_retries counter`,
      `bot_http_retries ${metrics.httpRetries}`,
      `# HELP bot_rate_limit_hits Rate limit hits (upstream)`,
      `# TYPE bot_rate_limit_hits counter`,
      `bot_rate_limit_hits ${metrics.rateLimitHits}`,
      `# HELP bot_cron_runs Cron runs`,
      `# TYPE bot_cron_runs counter`,
      `bot_cron_runs ${metrics.cronRuns}`,
      `# HELP bot_cron_errors Cron errors`,
      `# TYPE bot_cron_errors counter`,
      `bot_cron_errors ${metrics.cronErrors}`,
      `# HELP bot_cron_skipped_due_to_lock Cron skipped`,
      `# TYPE bot_cron_skipped_due_to_lock counter`,
      `bot_cron_skipped_due_to_lock ${metrics.cronSkippedDueToLock}`,
      `# HELP bot_cron_aborted Cron aborted`,
      `# TYPE bot_cron_aborted counter`,
      `bot_cron_aborted ${metrics.cronAborted}`,
      `# HELP bot_http_rate_limit_drops HTTP requests blocked by local rate limiter`,
      `# TYPE bot_http_rate_limit_drops counter`,
      `bot_http_rate_limit_drops ${metrics.httpRateLimitDrops}`,
      `# HELP bot_cache_single Cache single size`,
      `# TYPE bot_cache_single gauge`,
      `bot_cache_single ${cacheSizes.single}`,
      `# HELP bot_cache_dlc Cache DLC size`,
      `# TYPE bot_cache_dlc gauge`,
      `bot_cache_dlc ${cacheSizes.dlc}`,
      `# HELP bot_cache_updates_valid Updates cache valid`,
      `# TYPE bot_cache_updates_valid gauge`,
      `bot_cache_updates_valid ${cacheSizes.updatesValid ? 1 : 0}`,
      `# HELP bot_cache_deals_currencies_valid Deals cache currencies count`,
      `# TYPE bot_cache_deals_currencies_valid gauge`,
      `bot_cache_deals_currencies_valid ${cacheSizes.dealsCurrenciesValid}`,
      `# HELP bot_cache_user_cooldowns User cooldowns size`,
      `# TYPE bot_cache_user_cooldowns gauge`,
      `bot_cache_user_cooldowns ${cacheSizes.userCooldowns}`,
      `# HELP bot_cache_guild_settings Guild settings cache size`,
      `# TYPE bot_cache_guild_settings gauge`,
      `bot_cache_guild_settings ${getGuildCacheSize()}`,
      `# HELP bot_cache_enriched_deals_size Enriched deals cache size`,
      `# TYPE bot_cache_enriched_deals_size gauge`,
      `bot_cache_enriched_deals_size ${scrapers.getEnrichedCacheSize()}`,
      `# HELP bot_http_rate_limit_map_size Local HTTP rate limit map size`,
      `# TYPE bot_http_rate_limit_map_size gauge`,
      `bot_http_rate_limit_map_size ${rateLimitMap.size}`,
      `# HELP bot_active_locks Active distributed locks`,
      `# TYPE bot_active_locks gauge`,
      `bot_active_locks ${activeLocks.size}`
    ];
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(lines.join("\n") + "\n");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// -------------------------------------------------------------
// DISCORD EVENTS
// -------------------------------------------------------------
client.once("ready", async () => {
  logger("INFO", "DISCORD", `Conectat ca ${client.user.tag}`);
  try {
    await commands.registerSlashCommands(env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID);
  } catch (err) {
    logger("ERROR", "DISCORD", "Eșec înregistrare slash commands", err.message);
    adminAlert("slash:register-failed", "Slash commands nu au putut fi înregistrate", err.message).catch(() => null);
  }
  startHousekeeping();
  scheduleNextCron();
});

// V9: înfășurăm fiecare interacțiune într-un context cu req_id propriu.
// Toate apelurile logger() din lanțul de await-uri vor include automat req_id.
client.on("interactionCreate", async (interaction) => {
  const reqId = crypto.randomBytes(6).toString("hex");
  await requestContext.run({ requestId: reqId }, async () => {
    try { await commands.handleInteraction(interaction, games); }
    catch (err) {
      logger("ERROR", "INTERACTION", "Eroare top-level la interactionCreate", err.stack || err.message);
    }
  });
});

client.on("error", (err) => logger("ERROR", "DISCORD", "Eroare client Discord", err.message));
client.on("warn", (msg) => logger("WARN", "DISCORD", msg));
client.on("shardError", (err) => logger("ERROR", "DISCORD", "Shard error", err.message));

// -------------------------------------------------------------
// MONGO EVENTS
// -------------------------------------------------------------
mongoose.connection.on("connected", () => logger("INFO", "DB", "Conectat la MongoDB"));
mongoose.connection.on("disconnected", () => logger("WARN", "DB", "Deconectat de la MongoDB"));
mongoose.connection.on("error", (err) => logger("ERROR", "DB", "Eroare MongoDB", err.message));
mongoose.connection.on("reconnected", () => logger("INFO", "DB", "Reconectat la MongoDB"));

// -------------------------------------------------------------
// SHUTDOWN
// -------------------------------------------------------------
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger("INFO", "SHUTDOWN", `Semnal primit: ${signal}, închidere...`);

  if (currentCronAbortController) currentCronAbortController.abort();
  if (cronTimerId) clearTimeout(cronTimerId);
  stopHeartbeat();
  stopHousekeeping();

  for (const [jobName, token] of activeLocks.entries()) {
    try { await releaseDbLock(jobName, token); }
    catch (err) { logger("WARN", "SHUTDOWN", `Eroare la eliberare lock ${jobName}`, err.message); }
  }

  if (env.SHUTDOWN_DRAIN_MS > 0) {
    logger("INFO", "SHUTDOWN", `Drain ${env.SHUTDOWN_DRAIN_MS}ms pentru comenzi în zbor`);
    await new Promise(r => setTimeout(r, env.SHUTDOWN_DRAIN_MS));
  }

  try { client.destroy(); } catch (err) { logger("WARN", "SHUTDOWN", "Eroare destroy client", err.message); }
  try { await mongoose.connection.close(); } catch (err) { logger("WARN", "SHUTDOWN", "Eroare închidere mongo", err.message); }
  try { httpServer.close(); } catch { /* ignore */ }

  logger("INFO", "SHUTDOWN", "Închidere completă.");
  setTimeout(() => process.exit(exitCode), 500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
function handleFatalProcessError(kind, reason) {
  const detail = reason?.stack || reason?.message || String(reason);
  logger("ERROR", "PROCESS", kind, detail);
  adminAlert(`process:${kind}`, kind, detail)
    .catch(() => null)
    .finally(() => shutdown(kind, 1));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("uncaughtException", (err) => {
  handleFatalProcessError("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  handleFatalProcessError("unhandledRejection", reason);
});

// -------------------------------------------------------------
// BOOTSTRAP
// -------------------------------------------------------------
(async () => {
  try {
    // V9: maxPoolSize configurabil — important pentru deployments cu mai
    // multe guild-uri active care fac update-uri în paralel.
    await mongoose.connect(env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: env.MONGO_MAX_POOL_SIZE
    });
    const ready = await waitForMongoReady(15000);
    if (!ready) {
      logger("ERROR", "BOOT", "Mongo nu a devenit ready, exit");
      process.exit(1);
    }
    httpServer.listen(env.PORT, () => {
      logger("INFO", "HTTP", `Server pornit pe portul ${env.PORT}`);
    });
    await client.login(env.DISCORD_TOKEN);
  } catch (err) {
    logger("ERROR", "BOOT", "Eroare la bootstrap", err.stack || err.message);
    process.exit(1);
  }
})();
