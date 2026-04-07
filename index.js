const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
const http = require("http");
const cron = require("node-cron");
const Parser = require("rss-parser");
const crypto = require("crypto");
const { z } = require("zod");
const rssParser = new Parser();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

// -------------------------------------------------------------
// 1. SETĂRI GLOBALE ȘI CONSTANTE
// -------------------------------------------------------------
const PREFIX = "big_master!";
const STEAM_STORE_ID = 1;
const EPIC_STORE_ID = 25;

const CACHE_TTL_MS = 180000;
const STALE_CACHE_TTL_MS = 15 * 60 * 1000;

const MAX_DEALS = 50;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = 300;

const FETCH_CONCURRENCY = 6;
const FETCH_JITTER_MS = 120;
const PER_SOURCE_TIMEOUT_MS = 9000;
const COMMAND_TIMEOUT_MS = 40000;
const DEALS_TIMEOUT_MS = 20000;
const DEALS_ENRICH_TIMEOUT_MS = 5000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

// -------------------------------------------------------------
// 1.1. UTILAJE DE BAZĂ
// -------------------------------------------------------------
function smoothTime(oldMs, newMs, alpha = 0.3) {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}

function safeStringify(value) {
  try { return JSON.stringify(value); }
  catch (e) { return String(value); }
}

function logger(level, context, message, meta = "") {
  const timestamp = new Date().toISOString();
  const format = `[${timestamp}] [${level}] [${context}] ${message} ${meta ? safeStringify(meta) : ""}`;
  if (level === "ERROR") console.error(format);
  else if (level === "WARN") console.warn(format);
  else console.log(format);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, timeoutMessage = "Timeout") {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPool(items, limit, workerFn) {
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) break;
      try {
        results[index] = await workerFn(items[index], index);
      } catch (err) {
        results[index] = err;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

// -------------------------------------------------------------
// 2. VALIDARE CONFIG CU ZOD
// -------------------------------------------------------------
const GameSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["steam", "intel", "nvidia", "amd", "roblox", "minecraft", "epic_games", "listing_based"]),
  aliases: z.array(z.string()).optional(),
  appId: z.string().optional(),
  url: z.string().url().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string()).optional(),
  thumbnail: z.string().url().optional()
}).superRefine((game, ctx) => {
  if (game.type === "steam" && !game.appId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Steam "${game.name}" trebuie să aibă appId.` });
  }
  if (game.type === "intel" && !game.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Intel "${game.name}" trebuie să aibă url.` });
  }
  if (game.type === "listing_based" || (game.type === "epic_games" && game.key !== "fortnite")) {
    const hasListing = game.listingUrl || (Array.isArray(game.listingUrls) && game.listingUrls.length > 0);
    if (!hasListing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită listingUrl/Urls.` });
    }
    if (!game.baseUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită baseUrl.` });
    }
  }
});

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().int().positive().refine(
    (v) => [5, 10, 15, 20, 30, 60].includes(v),
    { message: "checkIntervalMinutes trebuie să fie 5, 10, 15, 20, 30 sau 60." }
  ),
  games: z.array(GameSchema).min(1).superRefine((games, ctx) => {
    const keys = games.map(g => g.key);
    const duplicates = keys.filter((item, index) => keys.indexOf(item) !== index);
    if (duplicates.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chei duplicate: ${[...new Set(duplicates)].join(", ")}` });
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

// -------------------------------------------------------------
// 3. MONGODB & DISCORD CLIENT
// -------------------------------------------------------------
const guildSchema = new mongoose.Schema({
  _id: String,
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: mongoose.Schema.Types.Mixed, default: {} },

  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: [String], default: [] },

  minDiscountPercent: { type: Number, default: 70 },
  includeFreeGames: { type: Boolean, default: true },
  includePaidDiscounts: { type: Boolean, default: true },
  notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" }
}, { minimize: false });

const GuildModel = mongoose.model("Guild", guildSchema);

const circuitBreakerSchema = new mongoose.Schema({
  _id: String,
  fails: { type: Number, default: 0 },
  cooldownUntil: { type: Date, default: null }
}, { minimize: false });

const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: {
    all: { type: Number, default: 15000 },
    single: { type: Number, default: 2000 },
    reduceri: { type: Number, default: 15000 },
    startUpdates: { type: Number, default: 10000 },
    startReduceri: { type: Number, default: 10000 }
  }
}, { minimize: false });

const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({
  _id: String,
  lockedUntil: { type: Date, default: null, index: true },
  ownerToken: { type: String, default: null }
}, { minimize: false });

const JobLockModel = mongoose.model("JobLock", jobLockSchema);
const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const lockToken = crypto.randomUUID();

  try {
    const lock = await JobLockModel.findOneAndUpdate(
      { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { lockedUntil: expires, ownerToken: lockToken } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }
    return null;
  } catch (err) {
    if (err.code !== 11000) logger("WARN", "DB_LOCK", "Nu s-a putut obține lock", err.message);
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
    logger("WARN", "DB_LOCK", "Renew lock failed", err.message);
    return false;
  }
}

async function releaseDbLock(jobName, token) {
  if (!token) return;
  try {
    await JobLockModel.updateOne(
      { _id: `lock_${jobName}`, ownerToken: token },
      { $set: { lockedUntil: new Date(0), ownerToken: null } }
    );
    activeLocks.delete(jobName);
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la eliberare lock", err.message);
  }
}

async function getSystemTimes() {
  let sys = await SystemModel.findById("system_state").lean();
  if (!sys) {
    sys = {
      _id: "system_state",
      executionTimes: {
        all: 15000,
        single: 2000,
        reduceri: 15000,
        startUpdates: 10000,
        startReduceri: 10000
      }
    };
    await SystemModel.create(sys);
  }
  return sys.executionTimes || {
    all: 15000,
    single: 2000,
    reduceri: 15000,
    startUpdates: 10000,
    startReduceri: 10000
  };
}

async function saveSystemTimes(times) {
  await SystemModel.findByIdAndUpdate(
    "system_state",
    { $set: { executionTimes: times } },
    { upsert: true }
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// -------------------------------------------------------------
// 4. SERVER WEB PENTRU HEALTHCHECK
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/health") {
    const mongoOk = mongoose.connection.readyState === 1;
    const discordOk = typeof client.isReady === "function" && client.isReady();

    if (mongoOk && discordOk) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, mongoOk, discordOk, message: "Toate sistemele sunt online." }));
    }

    logger("WARN", "HEALTH", "Healthcheck picat", { mongoOk, discordOk });
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, mongoOk, discordOk, message: "Sisteme indisponibile." }));
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK\n");
}).listen(PORT, "0.0.0.0", () => logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT}`));

// -------------------------------------------------------------
// 5. SHUTDOWN GRACEFUL
// -------------------------------------------------------------
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
  try {
    for (const [jobName, token] of activeLocks.entries()) {
      await releaseDbLock(jobName, token);
    }
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    client.destroy();
    process.exit(0);
  } catch (err) {
    logger("ERROR", "SHUTDOWN", "Eroare la oprire:", err.message);
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------------------------------------------------
// CACHE
// -------------------------------------------------------------
const cache = {
  updates: { data: null, expiresAt: 0, staleExpiresAt: 0 },
  deals: { data: null, expiresAt: 0, staleExpiresAt: 0 },
  single: new Map(),
  latestByGame: new Map()
};

const inflight = {
  updates: null,
  deals: null,
  single: new Map()
};

function cleanCache() {
  const now = Date.now();

  if (cache.updates.staleExpiresAt < now) cache.updates = { data: null, expiresAt: 0, staleExpiresAt: 0 };
  if (cache.deals.staleExpiresAt < now) cache.deals = { data: null, expiresAt: 0, staleExpiresAt: 0 };

  for (const [key, value] of cache.single.entries()) {
    if (value.staleExpiresAt < now) cache.single.delete(key);
  }
}

function setCacheEntry(bucket, data, ttlMs = CACHE_TTL_MS, staleTtlMs = STALE_CACHE_TTL_MS) {
  cache[bucket] = {
    data,
    expiresAt: Date.now() + ttlMs,
    staleExpiresAt: Date.now() + staleTtlMs
  };
}

function isFresh(entry) {
  return !!entry?.data && Date.now() < entry.expiresAt;
}

function isStaleButUsable(entry) {
  return !!entry?.data && Date.now() < entry.staleExpiresAt;
}

function rememberLatestByGame(gameKey, latest) {
  if (!latest) return;
  cache.latestByGame.set(gameKey, {
    data: latest,
    expiresAt: Date.now() + CACHE_TTL_MS,
    staleExpiresAt: Date.now() + STALE_CACHE_TTL_MS
  });
}

function getRememberedLatestByGame(gameKey) {
  const entry = cache.latestByGame.get(gameKey);
  if (!entry?.data) return null;
  if (Date.now() >= entry.staleExpiresAt) {
    cache.latestByGame.delete(gameKey);
    return null;
  }
  return entry.data;
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE & EMBEDS
// -------------------------------------------------------------
function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(str, maxLen) {
  const t = String(str || "");
  return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t;
}

function normalizeUpdate(data) {
  return {
    id: String(data.id || ""),
    title: truncate(data.title || "Update nou", 250),
    link: String(data.link || ""),
    excerpt: truncate(data.excerpt || "", 700),
    fullText: truncate(data.fullText || "", 3500),
    image: data.image || null,
    thumbnail: data.thumbnail || null,
    timestamp: data.timestamp || ""
  };
}

function buildUpdateEmbed(gameName, latest, mode = "detailed") {
  const isCompact = mode === "compact";

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(truncate(latest.title, 256))
    .setFooter({ text: truncate(gameName, 2048) });

  if (latest.link) embed.setURL(latest.link);

  if (isCompact) {
    embed.setDescription(
      latest.link
        ? `Apasă pe titlu pentru a citi patch-ul.`
        : `A apărut un nou update pentru ${gameName}.`
    );
  } else {
    embed.setDescription(truncate(latest.excerpt || `A apărut un nou update pentru ${gameName}.`, 4096));
    if (latest.image) embed.setImage(latest.image);
    if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
    if (latest.timestamp) {
      const d = new Date(latest.timestamp);
      if (!Number.isNaN(d.getTime())) embed.setTimestamp(d);
    }
  }

  return embed;
}

function buildDealEmbed(deal, mode = "detailed") {
  const isFree = parseFloat(deal.salePrice) === 0;
  const isCompact = mode === "compact";

  const embed = new EmbedBuilder()
    .setColor(isFree ? 0xffd700 : 0xe74c3c)
    .setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));

  if (isCompact) {
    embed.setDescription(
      `**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? "GRATUIT" : "$" + deal.salePrice}**\n[Apasă aici pentru link](${deal.link})`
    );
  } else {
    embed
      .setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(
        `**${deal.store}** oferă o reducere de **${deal.savings}%**!\n\n` +
        (deal.endDateStr !== "Nespecificat" ? `⏳ **${isFree ? "Gratis până la" : "Expiră la"}:** ${deal.endDateStr}\n\n` : ""),
        4096
      ))
      .addFields(
        { name: "Preț Vechi", value: `~~$${deal.normalPrice}~~`, inline: true },
        { name: "Preț Nou", value: isFree ? "🔥 GRATUIT 🔥" : `$${deal.salePrice}`, inline: true },
        { name: "Link", value: `[Apasă aici](${deal.link})`, inline: false }
      );

    if (deal.thumbnail && deal.thumbnail.startsWith("http")) {
      embed.setThumbnail(deal.thumbnail);
    }
    if (deal.extraDetails) {
      embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails.trim(), 1024), inline: false });
    }
  }

  return embed;
}

function buildPaginationButtons(prefix, sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev_${sessionId}`)
      .setLabel("◀ Ant")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}_next_${sessionId}`)
      .setLabel("Urm ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed") {
  if (!items || items.length === 0) return;

  let currentPage = 0;
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = Date.now().toString();
  let collector = null;

  const updateMessage = async (interaction) => {
    try {
      const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
      const components = [buildPaginationButtons(prefix, sessionId, currentPage, totalPages)];

      if (interaction) await interaction.editReply({ embeds, components }).catch(() => null);
      else await interactionMessage.edit({ embeds, components }).catch(() => null);
    } catch (err) {
      if (collector) collector.stop("message_deleted");
    }
  };

  await updateMessage(null);

  collector = interactionMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300000
  });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) {
      return btn.reply({ content: "Doar autorul comenzii poate naviga!", ephemeral: true }).catch(() => null);
    }

    if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !== `${prefix}_next_${sessionId}`) return;

    if (btn.customId === `${prefix}_prev_${sessionId}`) currentPage--;
    if (btn.customId === `${prefix}_next_${sessionId}`) currentPage++;

    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));
    await btn.deferUpdate().catch(() => null);
    await updateMessage(btn);
  });

  collector.on("end", () => {
    if (interactionMessage.editable) {
      interactionMessage.edit({ components: [] }).catch(() => null);
    }
  });
}

function findGameAndSuggestion(text) {
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();

  if (search.length < 2) {
    const exact = config.games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }

  const candidates = [];

  for (const game of config.games) {
    const key = String(game.key).toLowerCase().replace(/[-_]/g, " ");
    const name = String(game.name).toLowerCase().replace(/[-_]/g, " ");
    const aliases = Array.isArray(game.aliases)
      ? game.aliases.map(a => String(a).toLowerCase().replace(/[-_]/g, " "))
      : [];

    const allIdentifiers = [key, name, ...aliases];

    if (allIdentifiers.includes(search)) return { game, suggestion: null };

    let bestDistForGame = Infinity;
    let isStartsWith = false;
    let isIncludes = false;

    for (const val of allIdentifiers) {
      if (val.startsWith(search)) isStartsWith = true;
      if (val.includes(search)) isIncludes = true;

      const dist = levenshtein(search, val);
      if (dist < bestDistForGame) bestDistForGame = dist;
    }

    candidates.push({ game, dist: bestDistForGame, isStartsWith, isIncludes });
  }

  candidates.sort((a, b) => {
    if (a.isStartsWith && !b.isStartsWith) return -1;
    if (!a.isStartsWith && b.isStartsWith) return 1;
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.isIncludes && !b.isIncludes) return -1;
    if (!a.isIncludes && b.isIncludes) return 1;
    return 0;
  });

  const best = candidates[0];
  if (!best) return { game: null, suggestion: null };

  const dynamicThreshold = Math.max(1, Math.floor(search.length * 0.3));

  if (best.dist <= 1 || best.isStartsWith) {
    return { game: best.game, suggestion: null };
  }

  if (best.dist <= dynamicThreshold || best.isIncludes) {
    return { game: null, suggestion: best.game };
  }

  return { game: null, suggestion: null };
}

// -------------------------------------------------------------
// HTTP & PROXY
// -------------------------------------------------------------
async function httpReq(method, url, options = {}, retries = 1, backoff = 700) {
  const reqConfig = {
    method,
    url,
    timeout: options.timeout || PER_SOURCE_TIMEOUT_MS,
    headers: {
      "User-Agent": randomUserAgent(),
      "Accept": "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
      ...options.headers
    },
    validateStatus: (status) => status >= 200 && status < 400
  };

  if (options.data) reqConfig.data = options.data;

  for (let i = 0; i <= retries; i++) {
    try {
      return await axios(reqConfig);
    } catch (err) {
      if (err.response?.status >= 400 && err.response?.status < 500 && err.response?.status !== 429) {
        throw err;
      }
      if (i === retries) throw err;
      await sleep(backoff);
      backoff *= 2;
    }
  }
}

async function fetchWithProxy(targetUrl, options = {}) {
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
  ];

  let lastErr;
  for (const proxy of proxies) {
    try {
      const res = await httpReq("GET", proxy, { timeout: options.timeout || PER_SOURCE_TIMEOUT_MS });
      return proxy.includes("allorigins")
        ? String(res?.data?.contents || "")
        : (typeof res.data === "string" ? res.data : JSON.stringify(res.data));
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`Proxy fallback epuizat: ${lastErr?.message}`);
}

// -------------------------------------------------------------
// FUNCȚII SCRAPING
// -------------------------------------------------------------
function absoluteUrl(base, maybeRelative) {
  try { return new URL(maybeRelative, base).href; }
  catch { return ""; }
}

function isGoodSteamArticleUrl(url) {
  const v = String(url || "").trim().toLowerCase();
  return !!(v && v.startsWith("http") && !v.includes("steamstatic") && !v.includes("steamcdn"));
}

function extractDateScore(url) {
  const u = String(url || "").toLowerCase();

  const m1 = u.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/);
  if (m1) {
    const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}`);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  const m2 = u.match(/\b([a-z]{3,9})[-/]?(\d{1,2})[-/]?(\d{4})\b/);
  if (m2) {
    const d = new Date(`${m2[1]} ${m2[2]}, ${m2[3]}`);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  return 0;
}

function scoreCandidate(candidate, keywords) {
  const haystack = `${candidate.href} ${candidate.text}`.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    if (haystack.includes(String(k).toLowerCase())) score += 1;
  }
  return score;
}

function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()) : [];
  const text = `${title} ${contents}`;

  const badWordsInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway"];
  const goodWords = [
    "update", "patch", "hotfix", "version", "release", "bugfix", "bug fix",
    "fixes", "fix", "notes", "patch notes", "changelog", "maintenance",
    "build", "client update", "title update", "release notes"
  ];

  if (badWordsInTitle.some((word) => title.includes(word))) return false;
  if (tags.includes("patchnotes")) return true;
  return goodWords.some((word) => text.includes(word));
}

async function fetchSteamUpdate(game) {
  const response = await httpReq(
    "GET",
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`
  );

  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter(item =>
      (item.feed_type === 1 || item.feedname === "steam_community_announcements") &&
      isGoodSteamArticleUrl(item.url) &&
      isLikelyPatchNote(item)
    )
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));

  if (!patchNotes.length) throw new Error("Lipsă patch notes Steam valabile.");

  const latest = patchNotes[0];
  const rawContents = String(latest.contents || "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/\[.*?\]/g, " ");

  return normalizeUpdate({
    id: String(latest.gid),
    title: cleanText(latest.title),
    link: String(latest.url),
    excerpt: rawContents,
    fullText: rawContents,
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : ""
  });
}

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length
    ? game.listingUrls
    : [game.listingUrl];

  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;

  const collected = [];

  await runPool(listingUrls, Math.min(3, listingUrls.length), async (url) => {
    try {
      const listRes = await httpReq("GET", url);
      const $ = cheerio.load(String(listRes.data));
      let position = 0;

      $("a").each((i, el) => {
        const href = absoluteUrl(game.baseUrl, $(el).attr("href"));
        if (!href) return;
        if (hrefRegex && !hrefRegex.test(href)) return;

        const candidate = {
          href,
          text: cleanText($(el).text()),
          position: position++
        };

        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) {
      logger("WARN", "SCRAPE", `Eșec accesare listingUrl pt ${game.name}`, err.message);
    }
  });

  const seen = new Set();
  const unique = collected.filter(item => {
    if (!item.href || seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });

  unique.sort((a, b) => {
    if (keywords.length) {
      const s = scoreCandidate(b, keywords) - scoreCandidate(a, keywords);
      if (s !== 0) return s;
    }
    const d = extractDateScore(b.href) - extractDateScore(a.href);
    if (d !== 0) return d;
    return a.position - b.position;
  });

  if (!unique.length) throw new Error("Nu am găsit ancore valide.");

  const articleUrl = unique[0].href;
  const articleRes = await httpReq("GET", articleUrl);
  const $art = cheerio.load(String(articleRes.data || ""));

  const ogTitle = $art('meta[property="og:title"]').attr("content") || $art("title").text() || "";
  const ogDesc = $art('meta[property="og:description"]').attr("content") || "";
  $art("script, style, nav, footer, header").remove();
  const rawContent = $art("article").text() || $art("main").text() || $art("body").text();

  return normalizeUpdate({
    id: String(articleUrl),
    title: cleanText(ogTitle) || `${game.name} Update`,
    link: articleUrl,
    excerpt: cleanText(ogDesc),
    fullText: cleanText(rawContent),
    thumbnail: game.thumbnail
  });
}

async function fetchFortniteUpdate() {
  try {
    const raw = await fetchWithProxy(
      "https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US",
      { timeout: PER_SOURCE_TIMEOUT_MS }
    );
    const posts = JSON.parse(raw || "{}")?.blogList;
    const valid = (posts || []).filter(p => p.slug && p.slug.toLowerCase() !== "news");
    if (!valid.length) throw new Error("Nu există postări valide.");

    const latest = valid.find(p => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];

    return normalizeUpdate({
      id: String(latest.slug),
      title: cleanText(latest.title),
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: cleanText(latest.shareDescription),
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date
    });
  } catch (err) {
    logger("WARN", "FETCH_FALLBACK", "Scrape direct eșuat pentru Fortnite, trecem pe RSS.", err.message);
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString((await httpReq("GET", backupUrl)).data);
    if (!feed.items || feed.items.length === 0) throw new Error("Eșec total Fortnite, lipsă items RSS.");

    return normalizeUpdate({
      id: feed.items[0].link,
      title: cleanText(feed.items[0].title),
      link: feed.items[0].link,
      excerpt: "Update oficial Fortnite.",
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: feed.items[0].pubDate
    });
  }
}

async function fetchAmdUpdate(game) {
  try {
    const rawContent = await fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
    const match = rawContent.match(/Adrenalin Edition\s+([\d\.]+)/i);
    if (match) {
      return normalizeUpdate({
        id: match[1],
        title: `AMD Radeon Adrenalin v${match[1]}`,
        link: "https://www.amd.com",
        excerpt: "Driver disponibil.",
        thumbnail: game.thumbnail
      });
    }
  } catch (err) {
    logger("WARN", "FETCH_FALLBACK", "Scrape direct eșuat pentru AMD, trecem pe RSS.", err.message);
  }

  const res = await httpReq("GET", `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec AMD, lipsă items RSS.");

  return normalizeUpdate({
    id: cleanText(feed.items[0].title),
    title: cleanText(feed.items[0].title).split(" - ")[0],
    link: feed.items[0].link,
    excerpt: "Update AMD.com.",
    thumbnail: game.thumbnail,
    timestamp: feed.items[0].pubDate
  });
}

async function fetchIntelUpdate(game) {
  try {
    const rawContent = await fetchWithProxy(game.url);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (match) {
      return normalizeUpdate({
        id: match[1],
        title: `${game.name} v${match[1]}`,
        link: game.url,
        excerpt: `Versiune găsită: ${match[1]}`,
        thumbnail: game.thumbnail
      });
    }
  } catch (err) {
    logger("WARN", "FETCH_FALLBACK", "Scrape direct eșuat pentru Intel, trecem pe RSS.", err.message);
  }

  const q = game.key === "intelpro"
    ? 'site:intel.com "Intel Arc Pro Graphics"'
    : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';

  const res = await httpReq("GET", `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec Intel, lipsă items RSS.");

  return normalizeUpdate({
    id: cleanText(feed.items[0].title),
    title: cleanText(feed.items[0].title).split(" - ")[0],
    link: feed.items[0].link,
    excerpt: "Update intel.com detectat.",
    thumbnail: game.thumbnail,
    timestamp: feed.items[0].pubDate
  });
}

async function fetchMinecraftUpdate() {
  const r = await httpReq("GET", "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const v = r?.data?.latest?.release;
  if (!v) throw new Error("Lipsă versiune JSON");

  return normalizeUpdate({
    id: v,
    title: `Minecraft ${v}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`,
    excerpt: `Versiunea ${v}`,
    thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg"
  });
}

async function fetchRobloxUpdate() {
  const r = await httpReq("GET", "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer");
  const v = r?.data?.clientVersionUpload;
  if (!v) throw new Error("Lipsă versiune API");

  return normalizeUpdate({
    id: String(v),
    title: "Roblox Update",
    link: "https://en.help.roblox.com/hc/en-us",
    excerpt: `Versiunea ${v}`,
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg"
  });
}

async function fetchNvidiaUpdate(g) {
  const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const r = await httpReq("GET", `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`);
  const f = await rssParser.parseString(r.data);
  if (!f.items || f.items.length === 0) throw new Error("Eșec Nvidia, lipsă items RSS.");

  return normalizeUpdate({
    id: f.items[0].link,
    title: cleanText(f.items[0].title).split(" - ")[0],
    link: f.items[0].link,
    thumbnail: g.thumbnail,
    timestamp: f.items[0].pubDate
  });
}

// -------------------------------------------------------------
// DISPECER FETCH + REDUCERI
// -------------------------------------------------------------
async function fetchGameUpdate(game) {
  const t = game.type;
  if (!t || t === "steam") return await fetchSteamUpdate(game);
  if (t === "minecraft") return await fetchMinecraftUpdate();
  if (t === "epic_games" && game.key === "fortnite") return await fetchFortniteUpdate();
  if (t === "roblox") return await fetchRobloxUpdate();
  if (t === "nvidia") return await fetchNvidiaUpdate(game);
  if (t === "intel") return await fetchIntelUpdate(game);
  if (t === "amd") return await fetchAmdUpdate(game);
  if (t === "listing_based" || t === "epic_games") return await fetchListingBasedUpdate(game);
  throw new Error("Tip necunoscut.");
}

async function executeFetchWithCircuitBreaker(game) {
  let cb = await CircuitBreakerModel.findById(game.key);
  if (!cb) cb = new CircuitBreakerModel({ _id: game.key });

  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) {
    const remembered = getRememberedLatestByGame(game.key);
    return {
      game,
      latest: remembered || null,
      error: remembered ? null : "Circuit Breaker Activ (Pauză temporară)",
      fromStaleCache: !!remembered
    };
  }

  try {
    const latest = await withTimeout(
      fetchGameUpdate(game),
      PER_SOURCE_TIMEOUT_MS,
      `Timeout la sursa ${game.key}`
    );

    if (cb.fails > 0 || cb.cooldownUntil) {
      cb.fails = 0;
      cb.cooldownUntil = null;
      await cb.save();
    }

    rememberLatestByGame(game.key, latest);
    return { game, latest, error: null, fromStaleCache: false };
  } catch (error) {
    cb.fails += 1;
    if (cb.fails >= 5) {
      cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000);
      logger("WARN", "CIRCUIT", `Sursa ${game.key} pusă pe pauză din cauza erorilor repetate.`);
    }
    await cb.save();

    const remembered = getRememberedLatestByGame(game.key);
    if (remembered) {
      return { game, latest: remembered, error: null, fromStaleCache: true };
    }

    return { game, latest: null, error: error.message, fromStaleCache: false };
  }
}

function mergeResultsKeepingAllGames(results) {
  const resultByKey = new Map();
  for (const item of results) resultByKey.set(item.game.key, item);

  return config.games.map((game) => {
    const current = resultByKey.get(game.key);
    if (current?.latest) return current;

    const remembered = getRememberedLatestByGame(game.key);
    if (remembered) {
      return { game, latest: remembered, error: null, fromStaleCache: true };
    }

    return current || { game, latest: null, error: "Fără date", fromStaleCache: false };
  });
}

async function getLatestForAllGames({ maxDurationMs = COMMAND_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();

  const results = await runPool(config.games, FETCH_CONCURRENCY, async (game) => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= maxDurationMs) {
      const remembered = getRememberedLatestByGame(game.key);
      return {
        game,
        latest: remembered || null,
        error: remembered ? null : "Oprit din cauza timeout-ului global",
        fromStaleCache: !!remembered
      };
    }

    if (FETCH_JITTER_MS > 0) {
      await sleep(Math.floor(Math.random() * FETCH_JITTER_MS));
    }

    return await executeFetchWithCircuitBreaker(game);
  });

  return mergeResultsKeepingAllGames(results.filter(Boolean));
}

async function getLatestForAllGamesCached({ maxDurationMs = COMMAND_TIMEOUT_MS, forceFresh = false } = {}) {
  if (!forceFresh && isFresh(cache.updates)) {
    return { results: cache.updates.data, fromCache: true, isStale: false };
  }

  if (inflight.updates) {
    try {
      const results = await withTimeout(inflight.updates, maxDurationMs, "Timeout fetch updates");
      return { results, fromCache: false, isStale: false };
    } catch (err) {
      if (!forceFresh && isStaleButUsable(cache.updates)) {
        return { results: cache.updates.data, fromCache: true, isStale: true };
      }
      throw err;
    }
  }

  inflight.updates = (async () => {
    const results = await getLatestForAllGames({ maxDurationMs });
    setCacheEntry("updates", results);
    return results;
  })();

  try {
    const results = await withTimeout(inflight.updates, maxDurationMs, "Timeout fetch updates");
    return { results, fromCache: false, isStale: false };
  } catch (err) {
    if (!forceFresh && isStaleButUsable(cache.updates)) {
      return { results: cache.updates.data, fromCache: true, isStale: true };
    }
    throw err;
  } finally {
    inflight.updates = null;
  }
}

async function enrichDealData(deal) {
  if (deal.enriched) return deal;

  if (deal.store === "Steam" && deal.steamAppID) {
    try {
      const res = await httpReq(
        "GET",
        `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}`,
        { timeout: DEALS_ENRICH_TIMEOUT_MS }
      );

      const data = res.data[deal.steamAppID]?.data;
      if (data && data.platforms) {
        deal.extraDetails += `\n**Platforme:** ${
          [
            data.platforms.windows ? "Win" : "",
            data.platforms.mac ? "Mac" : "",
            data.platforms.linux ? "Lin" : ""
          ].filter(Boolean).join(", ")
        }`;
      }

      const htmlRes = await httpReq("GET", deal.link, {
        timeout: DEALS_ENRICH_TIMEOUT_MS,
        headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
      });

      const match = String(htmlRes.data || "").match(/Offer ends\s+([^<]+)/i);
      if (match && match[1]) deal.endDateStr = match[1].trim();
    } catch (e) {
      logger("WARN", "STEAM_ENRICH", `Eșec enrich Steam id ${deal.steamAppID}`, e.message);
    }
  }

  deal.enriched = true;
  return deal;
}

async function fetchStoreDeals(storeId, name) {
  try {
    const res = await httpReq(
      "GET",
      `https://www.cheapshark.com/api/1.0/deals?storeID=${storeId}&onSale=1&pageSize=${MAX_DEALS}`,
      {
        timeout: 10000,
        headers: { "Accept": "application/json" }
      }
    );

    const rows = Array.isArray(res.data) ? res.data : [];
    return rows.map(d => {
      const savings = Math.round(parseFloat(d.savings) || 0);
      return {
        id: d.dealID,
        steamAppID: d.steamAppID,
        title: d.title,
        salePrice: d.salePrice,
        normalPrice: d.normalPrice,
        savings,
        store: name,
        link: storeId === STEAM_STORE_ID
          ? `https://store.steampowered.com/app/${d.steamAppID}`
          : `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
        popularityScore: (savings * 2) + Math.max(parseInt(d.steamRatingPercent) || 0, parseInt(d.metacriticScore) || 0),
        endDateStr: "Nespecificat",
        extraDetails: "",
        enriched: false,
        thumbnail: d.thumb || null
      };
    });
  } catch (err) {
    logger("WARN", "DEALS_FETCH", `Eroare la preluarea ofertelor CheapShark (StoreID: ${storeId})`, err.message);
    return [];
  }
}

async function fetchDeals() {
  const [steamDeals, epicDeals] = await Promise.all([
    fetchStoreDeals(STEAM_STORE_ID, "Steam"),
    fetchStoreDeals(EPIC_STORE_ID, "Epic Games")
  ]);

  const combined = [...steamDeals, ...epicDeals]
    .filter(Boolean)
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, MAX_DEALS);

  if (combined.length === 0) {
    throw new Error("Nicio sursă de reduceri nu a răspuns cu date valide.");
  }

  return combined;
}

async function getDealsCached({ maxDurationMs = DEALS_TIMEOUT_MS, forceFresh = false } = {}) {
  if (!forceFresh && isFresh(cache.deals)) {
    return { deals: cache.deals.data, fromCache: true, isStale: false };
  }

  if (inflight.deals) {
    try {
      const deals = await withTimeout(inflight.deals, maxDurationMs, "Timeout fetch deals");
      return { deals, fromCache: false, isStale: false };
    } catch (err) {
      if (!forceFresh && isStaleButUsable(cache.deals)) {
        return { deals: cache.deals.data, fromCache: true, isStale: true };
      }
      throw err;
    }
  }

  inflight.deals = (async () => {
    const deals = await fetchDeals();
    setCacheEntry("deals", deals);
    return deals;
  })();

  try {
    const deals = await withTimeout(inflight.deals, maxDurationMs, "Timeout fetch deals");
    return { deals, fromCache: false, isStale: false };
  } catch (err) {
    if (!forceFresh && isStaleButUsable(cache.deals)) {
      return { deals: cache.deals.data, fromCache: true, isStale: true };
    }
    throw err;
  } finally {
    inflight.deals = null;
  }
}

async function getSingleGameLatestCached(game, { maxDurationMs = 15000, forceFresh = false } = {}) {
  const existing = cache.single.get(game.key);

  if (!forceFresh && existing?.data && Date.now() < existing.expiresAt) {
    return { latest: existing.data, fromCache: true, isStale: false };
  }

  if (inflight.single.has(game.key)) {
    try {
      const latest = await withTimeout(inflight.single.get(game.key), maxDurationMs, `Timeout single ${game.key}`);
      return { latest, fromCache: false, isStale: false };
    } catch (err) {
      if (!forceFresh && existing?.data && Date.now() < existing.staleExpiresAt) {
        return { latest: existing.data, fromCache: true, isStale: true };
      }
      throw err;
    }
  }

  const promise = (async () => {
    const res = await executeFetchWithCircuitBreaker(game);
    if (res.error || !res.latest) {
      throw new Error(res.error || `Nu am găsit update pentru ${game.name}`);
    }

    cache.single.set(game.key, {
      data: res.latest,
      expiresAt: Date.now() + CACHE_TTL_MS,
      staleExpiresAt: Date.now() + STALE_CACHE_TTL_MS
    });

    rememberLatestByGame(game.key, res.latest);
    return res.latest;
  })();

  inflight.single.set(game.key, promise);

  try {
    const latest = await withTimeout(promise, maxDurationMs, `Timeout single ${game.key}`);
    return { latest, fromCache: false, isStale: false };
  } catch (err) {
    const remembered = getRememberedLatestByGame(game.key);
    if (remembered) {
      return { latest: remembered, fromCache: true, isStale: true };
    }
    if (!forceFresh && existing?.data && Date.now() < existing.staleExpiresAt) {
      return { latest: existing.data, fromCache: true, isStale: true };
    }
    throw err;
  } finally {
    inflight.single.delete(game.key);
  }
}

// -------------------------------------------------------------
// AUTOMATIZĂRI
// -------------------------------------------------------------
async function checkForUpdates() {
  const guilds = await GuildModel.find({ subscribed: true }).lean();
  if (guilds.length === 0) return;

  const { results } = await getLatestForAllGamesCached({
    maxDurationMs: COMMAND_TIMEOUT_MS,
    forceFresh: true
  });

  for (const g of guilds) {
    if (!g.notificationChannelId) continue;

    let channel;
    try {
      channel = await client.channels.fetch(g.notificationChannelId);
    } catch {
      continue;
    }

    if (!channel || !channel.isTextBased()) continue;

    const itemsToProcess = [];

    for (const { game, latest, error } of results) {
      if (error || !latest) continue;

      const currentSeen = g.seen?.[game.key];
      let seenArray = [];

      if (Array.isArray(currentSeen)) seenArray = currentSeen;
      else if (typeof currentSeen === "object" && currentSeen !== null && currentSeen.id) seenArray = [currentSeen.id];
      else if (typeof currentSeen === "string") seenArray = [currentSeen];

      if (!seenArray.includes(latest.id)) {
        seenArray.push(latest.id);
        if (seenArray.length > 5) seenArray.shift();

        itemsToProcess.push({
          embed: buildUpdateEmbed(game.name, latest, g.notificationMode),
          dbPayload: { [`seen.${game.key}`]: seenArray }
        });
      }
    }

    if (itemsToProcess.length > 0) {
      const mergedDbPayload = {};

      for (let i = 0; i < itemsToProcess.length; i += 10) {
        const chunk = itemsToProcess.slice(i, i + 10);
        try {
          await channel.send({ embeds: chunk.map(c => c.embed) });
          chunk.forEach(c => Object.assign(mergedDbPayload, c.dbPayload));
        } catch (err) {
          logger("ERROR", "SEND", `Eroare trimitere parțială update-uri către serverul ${g._id}`, err.message);
        }
      }

      if (Object.keys(mergedDbPayload).length > 0) {
        await GuildModel.updateOne({ _id: g._id }, { $set: mergedDbPayload });
      }
    }
  }
}

async function checkForDiscounts() {
  const guilds = await GuildModel.find({ discountsSubscribed: true }).lean();
  if (guilds.length === 0) return;

  try {
    const { deals } = await getDealsCached({
      maxDurationMs: DEALS_TIMEOUT_MS,
      forceFresh: true
    });

    for (const g of guilds) {
      if (!g.discountChannelId) continue;

      let channel;
      try {
        channel = await client.channels.fetch(g.discountChannelId);
      } catch {
        continue;
      }

      if (!channel || !channel.isTextBased()) continue;

      const seen = Array.isArray(g.seenDiscounts) ? g.seenDiscounts : [];
      const itemsToProcess = [];

      for (const d of deals) {
        const isFree = parseFloat(d.salePrice) === 0;

        if (isFree && !(g.includeFreeGames ?? true)) continue;
        if (!isFree) {
          if (!(g.includePaidDiscounts ?? true)) continue;
          if (d.savings < (g.minDiscountPercent || 70)) continue;
        }

        const dealHash = crypto
          .createHash("sha1")
          .update(`${d.title}_${d.store}_${d.salePrice}_${d.normalPrice}`)
          .digest("hex");

        if (!seen.includes(dealHash)) {
          itemsToProcess.push({ deal: { ...d }, hash: dealHash });
        }
      }

      if (itemsToProcess.length > 0) {
        const savedHashes = [];

        for (let i = 0; i < itemsToProcess.length; i += 10) {
          const chunkToProcess = itemsToProcess.slice(i, i + 10);
          const chunkEmbeds = [];

          for (const item of chunkToProcess) {
            try {
              if (!item.deal.enriched && g.notificationMode !== "compact") {
                await withTimeout(enrichDealData(item.deal), DEALS_ENRICH_TIMEOUT_MS, "Timeout enrich deal");
              }
            } catch (enrichErr) {
              logger("WARN", "ENRICH", "Eroare izolată la enrich deal", enrichErr.message);
            }
            chunkEmbeds.push(buildDealEmbed(item.deal, g.notificationMode).setTimestamp());
          }

          if (chunkEmbeds.length === 0) continue;

          try {
            await channel.send({ embeds: chunkEmbeds });
            savedHashes.push(...chunkToProcess.map(c => c.hash));
          } catch (e) {
            logger("ERROR", "SEND", `Eroare trimitere parțială reduceri către serverul ${g._id}`, e.message);
          }
        }

        if (savedHashes.length > 0) {
          await GuildModel.updateOne(
            { _id: g._id },
            { $push: { seenDiscounts: { $each: savedHashes, $slice: -DEALS_HISTORY_LIMIT } } }
          );
        }
      }
    }
  } catch (err) {
    logger("ERROR", "CRON_DISC", err.message);
  }
}

// -------------------------------------------------------------
// COMMAND HANDLERS
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("⛔ Doar un admin poate folosi comanda.");
  }

  const times = await getSystemTimes();

  if (subCommand === "updates") {
    const msg = await message.reply(`⏳ Setez canalul pentru update-uri... Durată estimată: **~${Math.max(1, Math.ceil((times.startUpdates || 10000) / 1000))} secunde**.`);
    const start = Date.now();

    try {
      const { results } = await getLatestForAllGamesCached({
        maxDurationMs: COMMAND_TIMEOUT_MS,
        forceFresh: false
      });

      const setPayload = {
        subscribed: true,
        notificationChannelId: message.channel.id
      };

      for (const r of results) {
        if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
      }

      await GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });

      const updated = await getSystemTimes();
      updated.startUpdates = smoothTime(times.startUpdates || 10000, Date.now() - start);
      await saveSystemTimes(updated);

      return msg.edit("✅ Update-uri automate activate pe acest canal.");
    } catch (err) {
      logger("ERROR", "START_UPDATES", "Eroare la pornirea update-urilor:", err.message);
      return msg.edit("❌ A apărut o eroare la preluarea datelor inițiale. Verifică logurile.");
    }
  }

  if (subCommand === "reduceri") {
    const msg = await message.reply(`⏳ Setez canalul pentru reduceri... Durată estimată: **~${Math.max(1, Math.ceil((times.startReduceri || 10000) / 1000))} secunde**.`);
    const start = Date.now();

    try {
      const { deals } = await getDealsCached({
        maxDurationMs: DEALS_TIMEOUT_MS,
        forceFresh: false
      });

      const initHashes = deals
        .map(d => crypto.createHash("sha1").update(`${d.title}_${d.store}_${d.salePrice}_${d.normalPrice}`).digest("hex"))
        .slice(-DEALS_HISTORY_LIMIT);

      await GuildModel.updateOne(
        { _id: guildId },
        {
          $set: {
            discountsSubscribed: true,
            discountChannelId: message.channel.id,
            seenDiscounts: initHashes
          }
        },
        { upsert: true }
      );

      const updated = await getSystemTimes();
      updated.startReduceri = smoothTime(times.startReduceri || 10000, Date.now() - start);
      await saveSystemTimes(updated);

      return msg.edit("✅ Alertele pentru reduceri au fost activate pe acest canal.");
    } catch (err) {
      logger("ERROR", "START_REDUCERI", "Eroare la pornirea reducerilor:", err.message);
      return msg.edit("❌ A apărut o eroare internă la activarea alertelor pentru reduceri.");
    }
  }

  return message.reply(`❌ Sintaxă: \`${PREFIX}start updates\` sau \`${PREFIX}start reduceri\`.`);
}

async function handleStop(message, subCommand, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("⛔ Doar un admin poate folosi comanda.");
  }

  try {
    if (subCommand === "updates") {
      await GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false, notificationChannelId: null } });
      return message.reply("🛑 Update-uri automate oprite pentru acest server.");
    }

    if (subCommand === "reduceri") {
      await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false, discountChannelId: null } });
      return message.reply("🛑 Alerte reduceri oprite pentru acest server.");
    }
  } catch (err) {
    logger("ERROR", "STOP_COMMAND", "Eroare la oprirea alertelor", err.message);
    return message.reply("❌ A apărut o eroare la salvarea modificărilor în baza de date.");
  }

  return message.reply(`❌ Sintaxă: \`${PREFIX}stop updates\` sau \`${PREFIX}stop reduceri\`.`);
}

async function handleSetCommand(message, args, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("⛔ Doar un administrator poate modifica preferințele.");
  }

  const setting = (args[0] || "").toLowerCase();
  const value = (args[1] || "").toLowerCase();

  if (!setting || !value) {
    return message.reply(
      `⚙️ **Setări disponibile pentru \`${PREFIX}set\`:**\n\n` +
      `- \`mode [compact/detailed]\`: Formă mesaj.\n` +
      `- \`mindiscount [număr]\`: Procent minim reducere.\n` +
      `- \`free [on/off]\`: Include jocuri gratuite.\n` +
      `- \`paid [on/off]\`: Include oferte plătite.\n\n` +
      `*Exemplu: \`${PREFIX}set mode compact\`*`
    );
  }

  const updateDoc = {};
  let confirmMsg = "";

  switch (setting) {
    case "mode":
      if (!["compact", "detailed"].includes(value)) return message.reply("❌ Valori permise: `compact` sau `detailed`.");
      updateDoc.notificationMode = value;
      confirmMsg = `✅ Modul de notificare setat pe: **${value}**`;
      break;

    case "mindiscount": {
      const min = parseInt(value, 10);
      if (isNaN(min) || min < 0 || min > 100) return message.reply("❌ Te rog introdu un procent între 0 și 100.");
      updateDoc.minDiscountPercent = min;
      confirmMsg = `✅ Procentajul minim pentru oferte setat la: **${min}%**`;
      break;
    }

    case "free":
      if (!["on", "off"].includes(value)) return message.reply("❌ Valori permise: `on` sau `off`.");
      updateDoc.includeFreeGames = value === "on";
      confirmMsg = `✅ Notificări pentru jocuri gratuite: **${value.toUpperCase()}**`;
      break;

    case "paid":
      if (!["on", "off"].includes(value)) return message.reply("❌ Valori permise: `on` sau `off`.");
      updateDoc.includePaidDiscounts = value === "on";
      confirmMsg = `✅ Notificări pentru oferte plătite: **${value.toUpperCase()}**`;
      break;

    default:
      return message.reply("❌ Setare necunoscută. Folosește `big_master!set` pentru lista de setări.");
  }

  try {
    await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true });
    return message.reply(confirmMsg);
  } catch (err) {
    logger("ERROR", "SET_COMMAND", "Eroare la salvarea setărilor de server", err.message);
    return message.reply("❌ A apărut o eroare internă la salvarea preferințelor.");
  }
}

async function handleLatestUpdates(message) {
  const estMs = (await getSystemTimes()).all || 15000;
  const msg = await message.reply(`⏳ Aduc ultimele update-uri de pe internet... Durată estimată: **~${Math.max(1, Math.ceil(estMs / 1000))} secunde**.`);
  const start = Date.now();

  let results;
  let isStale = false;

  try {
    const out = await getLatestForAllGamesCached({
      maxDurationMs: COMMAND_TIMEOUT_MS,
      forceFresh: false
    });

    results = out.results;
    isStale = !!out.isStale;

    const times = await getSystemTimes();
    times.all = smoothTime(estMs, Date.now() - start);
    await saveSystemTimes(times);
  } catch (err) {
    logger("ERROR", "LATEST_UPDATES", "Eroare fetch latest updates", err.message);
    return msg.edit("❌ Eroare la preluarea update-urilor.");
  }

  const valid = results.filter(r => r.latest !== null);
  if (!valid.length) return msg.edit("❌ Nu am putut prelua date.");

  const guild = await GuildModel.findById(message.guild.id).lean();
  const mode = guild?.notificationMode || "detailed";

  const generateEmbeds = async (page, totalP, currentMode) => {
    return valid
      .slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)
      .map(r => buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({
        text: `${r.game.name} • Pagina ${page + 1}/${totalP}${r.fromStaleCache ? " • cache" : ""}${isStale ? " • răspuns parțial din cache" : ""}`
      }));
  };

  await handlePagination(msg, message.author.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestDeals(message) {
  const estMs = (await getSystemTimes()).reduceri || 15000;
  const msg = await message.reply(`⏳ Caut reduceri... Durată estimată: **~${Math.max(1, Math.ceil(estMs / 1000))} secunde**.`);
  const start = Date.now();

  let rawDeals;
  let isStale = false;

  try {
    const out = await getDealsCached({
      maxDurationMs: DEALS_TIMEOUT_MS,
      forceFresh: false
    });

    rawDeals = out.deals;
    isStale = !!out.isStale;

    const times = await getSystemTimes();
    times.reduceri = smoothTime(estMs, Date.now() - start);
    await saveSystemTimes(times);
  } catch (err) {
    logger("ERROR", "LATEST_DEALS", "Eroare fetch latest deals", err.message);
    return msg.edit("❌ Eroare oferte.");
  }

  const top = rawDeals.slice(0, MAX_DEALS);
  if (!top.length) return msg.edit("❌ Nu am găsit reduceri disponibile.");

  const guild = await GuildModel.findById(message.guild.id).lean();
  const mode = guild?.notificationMode || "detailed";

  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(d => ({ ...d }));

    if (currentMode !== "compact") {
      await runPool(chunk, 3, async (d) => {
        try {
          await withTimeout(enrichDealData(d), DEALS_ENRICH_TIMEOUT_MS, "Timeout enrich paginare");
        } catch {}
      });
    }

    return chunk.map(d => buildDealEmbed(d, currentMode).setFooter({
      text: `Pagina ${page + 1}/${totalP}${isStale ? " • cache" : ""}`
    }));
  };

  await handlePagination(msg, message.author.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestSingle(message, gameText) {
  if (!gameText) {
    return message.reply(`❌ Specifică porecla/alias-ul jocului. Ex: \`${PREFIX}latest update cs2\`.`);
  }

  const estMs = (await getSystemTimes()).single || 2000;
  const loadingMsg = await message.reply(`⏳ Aduc update-ul cerut... Durată estimată: **~${Math.max(1, Math.ceil(estMs / 1000))} secunde**.`);
  const startTime = Date.now();

  const { game, suggestion } = findGameAndSuggestion(gameText);

  if (!game) {
    let errText = `❌ Nu am găsit jocul.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
    errText += ` Folosește \`${PREFIX}porecle\` pentru lista exactă și alias-uri.`;
    return loadingMsg.edit(errText).catch(() => null);
  }

  try {
    const out = await getSingleGameLatestCached(game, {
      maxDurationMs: 15000,
      forceFresh: false
    });

    const executionTimes = await getSystemTimes();
    executionTimes.single = smoothTime(estMs, Date.now() - startTime);
    await saveSystemTimes(executionTimes);

    const guild = await GuildModel.findById(message.guild.id).lean();

    let prefixText = `✅ Update pentru **${game.name}**:`;
    if (out.isStale) prefixText += ` *(din cache)*`;

    await loadingMsg.edit({
      content: prefixText,
      embeds: [buildUpdateEmbed(game.name, out.latest, guild?.notificationMode || "detailed")]
    }).catch(() => null);
  } catch (error) {
    logger("ERROR", "LATEST_SINGLE", `Eroare preluare update pentru ${gameText}`, error.message);
    await loadingMsg.edit("❌ Eroare preluare update.").catch(() => null);
  }
}

// -------------------------------------------------------------
// INIT
// -------------------------------------------------------------
client.once("ready", () => {
  logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);

  const runChecks = async () => {
    cleanCache();

    const lockToken = await acquireDbLock("main_cron_job", 120000);
    if (!lockToken) {
      return logger("WARN", "CRON", "Job blocat (altă instanță funcționează).");
    }

    const hb = setInterval(() => renewDbLock("main_cron_job", lockToken, 120000).catch(() => {}), 60000);

    try {
      await checkForUpdates();
      await checkForDiscounts();
    } catch (err) {
      logger("ERROR", "CRON", err.message);
    } finally {
      clearInterval(hb);
      await releaseDbLock("main_cron_job", lockToken);
    }
  };

  runChecks();

  const min = Number(config.checkIntervalMinutes || 30);
  cron.schedule(min === 60 ? "0 * * * *" : `*/${min} * * * *`, runChecks);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const rawContent = message.content.slice(PREFIX.length).trim();
  const rawMatches = rawContent.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const rawArgs = rawMatches.map(arg => arg.replace(/^["']|["']$/g, ""));

  const command = (rawArgs.shift() || "").toLowerCase();
  const subCommand = (rawArgs[0] || "").toLowerCase();

  if (command === "ping") return message.reply("Pong! 🏓");

  if (command === "games" || command === "porecle") {
    const lines = config.games.map(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return item;
    });

    let currentMsg = "🎮 **Jocuri și porecle urmărite:**\n";
    for (const line of lines) {
      if (currentMsg.length + line.length > 1900) {
        if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
        currentMsg = "";
      }
      currentMsg += line + "\n";
    }
    if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
    return;
  }

  if (command === "start") return handleStart(message, subCommand, message.guild.id);
  if (command === "stop") return handleStop(message, subCommand, message.guild.id);
  if (command === "set") return handleSetCommand(message, rawArgs, message.guild.id);

  if (command === "latest") {
    if (subCommand === "updates") return handleLatestUpdates(message);
    if (subCommand === "reduceri") return handleLatestDeals(message);
    if (subCommand === "update") return handleLatestSingle(message, rawArgs.slice(1).join(" "));
  }

  if (command === "help") {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("🤖 Meniul de Ajutor - Big Master")
      .addFields(
        {
          name: "🔔 Notificări Automate",
          value: `\`${PREFIX}start updates\`\n\`${PREFIX}stop updates\`\n\`${PREFIX}start reduceri\`\n\`${PREFIX}stop reduceri\``
        },
        {
          name: "⚙️ Preferințe Server (Admin)",
          value: `\`${PREFIX}set mode [compact/detailed]\`\n\`${PREFIX}set mindiscount [0-100]\`\n\`${PREFIX}set free [on/off]\`\n\`${PREFIX}set paid [on/off]\``
        },
        {
          name: "🔍 Comenzi Manuale",
          value:
            `\`${PREFIX}latest updates\`\n` +
            `\`${PREFIX}latest reduceri\`\n` +
            `\`${PREFIX}latest update [poreclă/alias]\`\n` +
            `\`${PREFIX}porecle\` - Lista jocurilor și alias-urilor`
        }
      );

    return message.reply({ embeds: [helpEmbed] });
  }
});

async function bootstrap() {
  if (!process.env.MONGO_URI || !process.env.DISCORD_TOKEN) {
    logger("ERROR", "BOOT", "CRITIC: Lipsesc variabile de mediu!");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    logger("INFO", "DB", "Conectat la MongoDB!");
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    logger("ERROR", "BOOT", "Eroare la bootare:", err.message);
    process.exit(1);
  }
}

bootstrap();
