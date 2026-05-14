"use strict";
// =============================================================
// index.js — bootstrap final:
//   * validarea env e centralizată în db.js (require-ul face validarea)
//   * aici rămâne doar: validare config.json, Discord client, cron,
//     HTTP server, process handlers.
// =============================================================
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const mongoose = require("mongoose");
const cron = require("node-cron");
const { z } = require("zod");
const { Client, GatewayIntentBits } = require("discord.js");
// IMPORTANT: db.js validează env la require-time. Dacă env e invalid,
// procesul iese cu exit(1) ÎNAINTE de orice altceva.
const {
  logger,
  env,
  acquireDbLock, renewDbLock, releaseDbLock, activeLocks,
  getGuildCacheSize, cleanGuildCache,
  adminAlert
} = require("./db");
const scrapers = require("./scrapers");
const commands = require("./commands");
// -------------------------------------------------------------
// METRICI
// -------------------------------------------------------------
const metrics = {
  startedAt: Date.now(),
  cronRuns: 0,
  cronErrors: 0,
  fetchSuccess: 0,
  fetchFail: 0,
  httpRetries: 0,
  rateLimitHits: 0,
  lastCronAt: null,
  lastCronDurationMs: 0,
  unhandledRejections: 0,
  uncaughtExceptions: 0,
  cronAbortedNoLock: 0
};
scrapers.attachMetrics(metrics);
// -------------------------------------------------------------
// VALIDARE CONFIG.JSON (rămâne aici fiindcă e specific aplicației)
// -------------------------------------------------------------
const ALLOWED_CRON_INTERVALS = [5, 10, 15, 20, 30, 60];
const KEY_PATTERN = /^[a-z0-9_-]+$/;
function isValidRegex(s) {
  try { new RegExp(s); return true; } catch { return false; }
}
const GameSchema = z.object({
  key: z.string().regex(KEY_PATTERN, "key trebuie să conțină doar litere mici, cifre, _ sau -"),
  name: z.string().min(1),
  type: z.enum(["steam", "intel", "nvidia", "amd", "roblox", "minecraft", "epic_games",
"listing_based"]),
  aliases: z.array(z.string()).optional(),
  appId: z.string().optional(),
  url: z.string().url().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional().refine(
    (v) => v === undefined || isValidRegex(v),
    { message: "articleHrefRegex nu este o expresie regulată validă." }
  ),
  requireKeywords: z.array(z.string()).optional(),
  thumbnail: z.string().url().optional()
}).superRefine((game, ctx) => {
  if (game.type === "steam" && !game.appId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Steam "${game.name}" trebuie să
aibă appId.` });
  }
  if (game.type === "intel" && !game.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Intel "${game.name}" trebuie să
aibă url.` });
  }
  if (game.type === "listing_based" || (game.type === "epic_games" && game.key !== "fortnite"))
{
    const hasListing = game.listingUrl || (Array.isArray(game.listingUrls) &&
game.listingUrls.length > 0);
    if (!hasListing) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}"
necesită listingUrl/Urls.` });
    if (!game.baseUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul
"${game.name}" necesită baseUrl.` });
  }
});
const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().int().positive().refine(
    (v) => ALLOWED_CRON_INTERVALS.includes(v),
    { message: `checkIntervalMinutes trebuie să fie unul din: ${ALLOWED_CRON_INTERVALS.join(",
")}.` }
  ),
  games: z.array(GameSchema).min(1).superRefine((games, ctx) => {
    const keys = games.map(g => g.key);
    const dupKeys = keys.filter((item, index) => keys.indexOf(item) !== index);
    if (dupKeys.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chei duplicate: ${[...new
Set(dupKeys)].join(", ")}` });
    }
    const aliasToGame = new Map();
    for (const g of games) {
      if (!Array.isArray(g.aliases)) continue;
      for (const a of g.aliases) {
        const norm = String(a).toLowerCase().trim();
        if (!norm) continue;
        if (aliasToGame.has(norm) && aliasToGame.get(norm) !== g.key) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Aliasul "${a}" este folosit de mai multe jocuri (${aliasToGame.get(norm)}
și ${g.key}).`
          });
        } else {
          aliasToGame.set(norm, g.key);
        }
        if (keys.includes(norm) && norm !== g.key.toLowerCase()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Aliasul "${a}" al jocului "${g.key}" coincide cu cheia altui joc.`
          });
        }
      }
    }
  })
});
let config;
try {
  const CONFIG_PATH = path.join(__dirname, "config.json");
  config = ConfigSchema.parse(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
} catch (err) {
  logger("ERROR", "CONFIG", "Eroare validare config.json", err.issues || err.message);
  process.exit(1);
}
const games = config.games;
// -------------------------------------------------------------
// DISCORD CLIENT
// -------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
// -------------------------------------------------------------
// HTTP HEALTH/METRICS SERVER
// -------------------------------------------------------------
const PORT = env.PORT;
const CRON_INTERVAL_MS = Number(config.checkIntervalMinutes) * 60 * 1000;
const CRON_STUCK_THRESHOLD_MS = 3 * CRON_INTERVAL_MS;
const METRICS_TOKEN = env.METRICS_TOKEN;
const METRICS_PUBLIC = env.METRICS_PUBLIC;
function isMetricsAuthorized(req) {
  if (METRICS_PUBLIC && !METRICS_TOKEN) return true;
  if (METRICS_TOKEN) {
    try {
      const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const supplied = u.searchParams.get("token") || req.headers["x-metrics-token"] || "";
      if (!supplied) return false;
      const a = Buffer.from(String(supplied));
      const b = Buffer.from(METRICS_TOKEN);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch { return false; }
  }
  return false;
}
http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/health")) {
    const mongoOk = mongoose.connection.readyState === 1;
    const discordOk = typeof client.isReady === "function" && client.isReady();
    const now = Date.now();
    const sinceStart = now - metrics.startedAt;
    let cronStuck = false;
    if (sinceStart > 2 * CRON_INTERVAL_MS) {
      const lastCronTs = metrics.lastCronAt ? new Date(metrics.lastCronAt).getTime() : 0;
      cronStuck = (now - lastCronTs) > CRON_STUCK_THRESHOLD_MS;
    }
    const ok = mongoOk && discordOk && !cronStuck;
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok, mongoOk, discordOk, cronStuck,
      message: ok ? "Toate sistemele sunt online."
        : (cronStuck ? "Cronul pare blocat." : "Sisteme indisponibile.")
    }));
  }
  if (req.url && req.url.startsWith("/metrics")) {
    if (!isMetricsAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    const uptime = Math.round((Date.now() - metrics.startedAt) / 1000);
    const sizes = commands.getCacheSizes();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      uptime_seconds: uptime,
      cron_runs: metrics.cronRuns,
      cron_errors: metrics.cronErrors,
      cron_last_at: metrics.lastCronAt,
      cron_last_duration_ms: metrics.lastCronDurationMs,
      cron_interval_ms: CRON_INTERVAL_MS,
      cron_aborted_no_lock: metrics.cronAbortedNoLock,
      fetch_success: metrics.fetchSuccess,
      fetch_fail: metrics.fetchFail,
      http_retries: metrics.httpRetries,
      rate_limit_hits: metrics.rateLimitHits,
      unhandled_rejections: metrics.unhandledRejections,
      uncaught_exceptions: metrics.uncaughtExceptions,
      cache_single_size: sizes.single,
      cache_dlc_size: sizes.dlc,
      cache_guild_settings_size: getGuildCacheSize(),
      cache_updates_valid: sizes.updatesValid,
      cache_deals_valid: sizes.dealsValid
    }, null, 2));
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK\n");
}).listen(PORT, "0.0.0.0", () => {
  let mode = "PRIVAT";
  if (METRICS_TOKEN) mode = "cu METRICS_TOKEN";
  else if (METRICS_PUBLIC) mode = "PUBLIC (opt-in)";
  logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT} — /metrics: ${mode}`);
});
// -------------------------------------------------------------
// PROCESS HANDLERS
// -------------------------------------------------------------
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
  const hardExit = setTimeout(() => {
    logger("ERROR", "SHUTDOWN", "Hard exit (timeout)");
    process.exit(1);
  }, 8000);
  if (typeof hardExit.unref === "function") hardExit.unref();
  try {
    for (const [jobName, token] of activeLocks.entries()) await releaseDbLock(jobName, token);
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    client.destroy();
    clearTimeout(hardExit);
    process.exit(0);
  } catch (err) {
    logger("ERROR", "SHUTDOWN", "Eroare la închidere", err.message);
    process.exit(1);
  }
};
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  metrics.unhandledRejections++;
  const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  logger("ERROR", "PROCESS", "Unhandled promise rejection", detail);
});
process.on("uncaughtException", (err) => {
  metrics.uncaughtExceptions++;
  logger("ERROR", "PROCESS", "Uncaught exception — închidere graceful", err.stack ||
err.message);
  gracefulShutdown("uncaughtException");
});
// -------------------------------------------------------------
// CACHE CLEANUP
// -------------------------------------------------------------
commands.startCacheCleaner();
const guildCleaner = setInterval(cleanGuildCache, 5 * 60 * 1000);
if (typeof guildCleaner.unref === "function") guildCleaner.unref();
// -------------------------------------------------------------
// CRON LOOP
// -------------------------------------------------------------
let isRunningCron = false;
async function runChecks() {
  if (isRunningCron) {
    return logger("WARN", "CRON", "Jobul anterior încă rulează pe această instanță, sar peste
ciclul actual.");
  }
  isRunningCron = true;
  commands.cleanCache();
  const lockToken = await acquireDbLock("main_cron_job", 120000);
  if (!lockToken) {
    metrics.cronAbortedNoLock++;
    logger("INFO", "CRON", "Lock-ul DB e deținut de altă instanță, sar peste acest ciclu.");
    isRunningCron = false;
    return;
  }
  let lockLost = false;
  const shouldAbort = () => lockLost;
  let consecutiveRenewFails = 0;
  const hb = setInterval(async () => {
    const ok = await renewDbLock("main_cron_job", lockToken, 120000).catch(() => false);
    if (ok) { consecutiveRenewFails = 0; return; }
    consecutiveRenewFails++;
    logger("WARN", "CRON", `Heartbeat lock eșuat (${consecutiveRenewFails}/2)`);
    if (consecutiveRenewFails >= 2 && !lockLost) {
      lockLost = true;
      metrics.cronAbortedNoLock++;
      logger("ERROR", "CRON", "Pierdut lock-ul DB după 2 renew eșuate consecutiv — abortez
jobul.");
      clearInterval(hb);
      adminAlert("cron:lock-lost", "Cron a pierdut lock-ul DB",
        "Heartbeat-ul de lock a eșuat de 2 ori consecutiv. Jobul curent va fi abortat și o altă
instanță poate prelua.")
        .catch(() => null);
    }
  }, 60000);
  const startedAt = Date.now();
  try {
    await commands.checkForUpdates(client, games, shouldAbort);
    if (lockLost) {
      logger("WARN", "CRON", "Sar peste checkForDiscounts pentru că lock-ul a fost pierdut.");
    } else {
      await commands.checkForDiscounts(client, shouldAbort);
    }
    metrics.cronRuns++;
  } catch (err) {
    metrics.cronErrors++;
    logger("ERROR", "CRON", "Eroare loop principal", err.message);
    adminAlert("cron:error", "Eroare în ciclul de cron",
      `Mesaj: ${err.message}\nStack:\n${err.stack || "(no stack)"}`).catch(() => null);
  } finally {
    metrics.lastCronAt = new Date().toISOString();
    metrics.lastCronDurationMs = Date.now() - startedAt;
    clearInterval(hb);
    if (!lockLost) await releaseDbLock("main_cron_job", lockToken);
    isRunningCron = false;
  }
}
client.once("ready", () => {
  logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);
  runChecks().catch(err => logger("ERROR", "CRON", "Eroare la runChecks inițial", err.message));
  const min = Number(config.checkIntervalMinutes || 30);
  let cronExpr;
  if (min === 60) cronExpr = "0 * * * *";
  else if (ALLOWED_CRON_INTERVALS.includes(min)) cronExpr = `*/${min} * * * *`;
  else { logger("WARN", "CRON", `Interval neuzual ${min}, fallback la 30 minute.`); cronExpr =
"*/30 * * * *"; }
  if (!cron.validate(cronExpr)) {
    logger("ERROR", "CRON", `Expresie cron invalidă "${cronExpr}", fallback la "*/30 * * * *"`);
    cronExpr = "*/30 * * * *";
  }
  logger("INFO", "CRON", `Programat cu expresia: ${cronExpr}`);
  cron.schedule(cronExpr, runChecks);
});
// -------------------------------------------------------------
// MESSAGE HANDLER
// -------------------------------------------------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(commands.PREFIX))
return;
  const rawContent = message.content.slice(commands.PREFIX.length).trim();
  const rawMatches = rawContent.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const rawArgs = rawMatches.map(arg => arg.replace(/^["']|["']$/g, ""));
  const command = (rawArgs.shift() || "").toLowerCase();
  const subCommand = (rawArgs[0] || "").toLowerCase();
  try {
    if (command === "ping") return message.reply("Pong! \u{1F4CD}");
    if (command === "games" || command === "porecle") return
commands.handleGamesCommand(message, games);
    if (command === "start") return commands.handleStart(message, subCommand, message.guild.id,
games);
    if (command === "stop") return commands.handleStop(message, subCommand, message.guild.id);
    if (command === "set") return commands.handleSetCommand(message, rawArgs, message.guild.id);
    if (command === "latest") {
      if (subCommand === "updates") return commands.handleLatestUpdates(message, games);
      if (subCommand === "reduceri") return commands.handleLatestDeals(message);
      if (subCommand === "pret") return commands.handlePriceSearch(message,
rawArgs.slice(1).join(" "));
      if (subCommand === "update") return commands.handleLatestSingle(message,
rawArgs.slice(1).join(" "), games);
    }
    if (command === "dlc") return commands.handleDlcSearch(message, rawArgs.join(" "));
    if (command === "status") return commands.handleStatus(message, rawArgs.join(" "), games);
    if (command === "help") return message.reply({ embeds: [commands.buildHelpEmbed()] });
  } catch (err) {
    logger("ERROR", "MSG_HANDLER", "Eroare în handler-ul de comenzi", err.stack || err.message);
    try { await message.reply("\u274C Eroare neașteptată la procesarea comenzii."); } catch {}
  }
});
// -------------------------------------------------------------
// BOOTSTRAP
// -------------------------------------------------------------
async function bootstrap() {
  try {
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS:
45000 });
    await client.login(env.DISCORD_TOKEN);
  } catch (err) {
    logger("ERROR", "BOOTSTRAP", "Eroare la pornire", err.message);
    process.exit(1);
  }
}
bootstrap();
