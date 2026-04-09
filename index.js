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

const CACHE_TTL_MS = 180000; // 3 minute pentru comenzi single și DLC
const GLOBAL_CACHE_TTL_MS = 1800000; // 30 minute pentru cache-ul general de deals/updates
const MAX_DEALS = 50;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = 300;
const FETCH_CONCURRENCY = 10;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

// --- UTILAJE DE BAZĂ ---
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

function formatUserError(err, defaultMsg = "A apărut o eroare internă.") {
  if (err) {
    const errorDetails = err.stack ? err.stack : (err.message || err);
    logger("WARN", "USER_COMMAND", defaultMsg, errorDetails);
  }
  return `❌ ${defaultMsg}`;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
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

function canSendEmbeds(channel, botId) {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return perms && perms.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]);
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
  if (game.type === "steam" && !game.appId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Steam "${game.name}" trebuie să aibă appId.` });
  if (game.type === "intel" && !game.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul Intel "${game.name}" trebuie să aibă url.` });
  if (game.type === "listing_based" || (game.type === "epic_games" && game.key !== "fortnite")) {
    const hasListing = game.listingUrl || (Array.isArray(game.listingUrls) && game.listingUrls.length > 0);
    if (!hasListing) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită listingUrl/Urls.` });
    if (!game.baseUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită baseUrl.` });
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
    if (duplicates.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chei duplicate: ${[...new Set(duplicates)].join(', ')}` });
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
  seen: { type: Map, of: [String], default: {} },

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
  executionTimes: { all: { type: Number, default: 35000 }, single: { type: Number, default: 2000 }, reduceri: { type: Number, default: 10000 } }
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
      { new: true } 
    );

    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }

    try {
      await JobLockModel.create({
        _id: `lock_${jobName}`,
        lockedUntil: expires,
        ownerToken: lockToken
      });
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
    const res = await JobLockModel.updateOne({ _id: `lock_${jobName}`, ownerToken: token }, { $set: { lockedUntil: expires } });
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

async function getSystemTimes() {
  let sys = await SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: { all: 35000, single: 2000, reduceri: 10000 } } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return sys.executionTimes || { all: 35000, single: 2000, reduceri: 10000 };
}

async function saveSystemTimes(times) { await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true }); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

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
    res.writeHead(503, { "Content-Type": "application/json" }); 
    return res.end(JSON.stringify({ ok: false, mongoOk, discordOk, message: "Sisteme indisponibile." }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK\n");
}).listen(PORT, "0.0.0.0", () => logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT}`));

// -------------------------------------------------------------
// 5. SHUTDOWN GRACEFUL
// -------------------------------------------------------------
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return; isShuttingDown = true;
  logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
  try {
    for (const [jobName, token] of activeLocks.entries()) await releaseDbLock(jobName, token);
    if (mongoose.connection.readyState === 1) await mongoose.connection.close();
    client.destroy(); process.exit(0);
  } catch (err) { 
    logger("ERROR", "SHUTDOWN", "Eroare la închidere", err.message);
    process.exit(1); 
  }
};
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------------------------------------------------
// CACHE (Cu implementare comportament LRU simplu)
// -------------------------------------------------------------
const cache = { 
  updates: { data: null, expiresAt: 0 }, 
  deals: { data: null, expiresAt: 0 }, 
  single: new Map(),
  dlc: new Map()
};

function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) {
    cache.updates.data = null;
    cache.updates.expiresAt = 0;
  }
  if (cache.deals.expiresAt < now) {
    cache.deals.data = null;
    cache.deals.expiresAt = 0;
  }
  for (const [key, value] of cache.single.entries()) {
    if (value.expiresAt < now) cache.single.delete(key);
  }
  for (const [key, value] of cache.dlc.entries()) {
    if (value.expiresAt < now) cache.dlc.delete(key);
  }

  if (cache.dlc.size > 100) {
    const oldestKeys = [...cache.dlc.keys()].slice(0, 20);
    oldestKeys.forEach(k => cache.dlc.delete(k));
  }
  if (cache.single.size > 100) {
    const oldestKeys = [...cache.single.keys()].slice(0, 20);
    oldestKeys.forEach(k => cache.single.delete(k));
  }
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE & EMBEDS
// -------------------------------------------------------------
function cleanText(text) { return String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim(); }
function truncate(str, maxLen) { const t = String(str || ""); return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t; }

function normalizeUpdate(data) {
  return { id: String(data.id || ""), title: truncate(data.title || "Update nou", 250), link: String(data.link || ""), excerpt: truncate(data.excerpt || "", 700), fullText: truncate(data.fullText || "", 3500), image: data.image || null, thumbnail: data.thumbnail || null, timestamp: data.timestamp || "" };
}

function buildUpdateEmbed(gameName, latest, mode = "detailed") {
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle(truncate(latest.title, 256)).setFooter({ text: truncate(gameName, 2048) }); 
  if (latest.link) embed.setURL(latest.link);

  if (isCompact) {
    embed.setDescription(latest.link ? `Apasă pe titlu pentru a citi patch-ul.` : `A apărut un nou update pentru ${gameName}.`);
  } else {
    embed.setDescription(truncate(latest.excerpt || `A apărut un nou update pentru ${gameName}.`, 4096));
    if (latest.image) embed.setImage(latest.image);
    if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
    if (latest.timestamp) { const d = new Date(latest.timestamp); if (!Number.isNaN(d.getTime())) embed.setTimestamp(d); }
  }
  return embed;
}

function buildDealEmbed(deal, mode = "detailed") {
  const isFree = parseFloat(deal.salePrice) === 0;
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder().setColor(isFree ? 0xffd700 : 0xe74c3c).setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));

  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? "GRATUIT" : "$" + deal.salePrice}**\n[Apasă aici pentru link](${deal.link})`);
  } else {
    let statsStr = "";
    if (deal.qualityScore > 0) {
      statsStr = `⭐ **Calitate:** ${deal.qualityScore}% aprecieri | 👥 **Popularitate:** ${deal.totalReviews > 0 ? deal.totalReviews + " recenzii" : "Top Seller"}\n\n`;
    }

    embed.setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(`**${deal.store}** oferă o reducere de **${deal.savings}%**!\n\n` + statsStr + (deal.endDateStr !== "Nespecificat" ? `⏳ **${isFree ? "Gratis până la" : "Expiră la"}:** ${deal.endDateStr}\n\n` : ""), 4096))
      .addFields(
        { name: "Preț Vechi", value: `~~$${deal.normalPrice}~~`, inline: true },
        { name: "Preț Nou", value: isFree ? "🔥 GRATUIT 🔥" : `$${deal.salePrice}`, inline: true },
        { name: "Link", value: `[Apasă aici](${deal.link})`, inline: false }
      );
    if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
    if (deal.extraDetails) embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails.trim(), 1024), inline: false });
  }
  return embed;
}

function buildPaginationButtons(prefix, sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("◀ Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm ▶").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed") {
  if (!items || items.length === 0) return;
  let currentPage = 0; const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = Date.now().toString();
  let collector = null;

  const updateMessage = async () => {
    try {
      const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
      const components = [buildPaginationButtons(prefix, sessionId, currentPage, totalPages)];
      await interactionMessage.edit({ embeds, components }).catch(() => null);
    } catch (err) { 
      if (collector) collector.stop("error"); 
    }
  };

  await updateMessage();

  collector = interactionMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) return btn.reply({ content: "Doar autorul comenzii poate naviga!", ephemeral: true }).catch(() => null);
    if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !== `${prefix}_next_${sessionId}`) return;

    if (btn.customId === `${prefix}_prev_${sessionId}`) currentPage--;
    if (btn.customId === `${prefix}_next_${sessionId}`) currentPage++;
    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));

    await btn.deferUpdate().catch(() => null);
    await updateMessage();
  });
  collector.on("end", () => {
    if (interactionMessage.editable) interactionMessage.edit({ components: [] }).catch(() => null);
  });
}

function findGameAndSuggestion(text) {
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length < 2) {
    const exact = config.games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }

  let candidates = [];
  for (const game of config.games) {
    const key = String(game.key).toLowerCase().replace(/[-_]/g, " "); 
    const name = String(game.name).toLowerCase().replace(/[-_]/g, " ");
    const aliases = Array.isArray(game.aliases) ? game.aliases.map(a => String(a).toLowerCase().replace(/[-_]/g, " ")) : [];
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

  if (best.dist <= 1) return { game: best.game, suggestion: null };
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) return { game: null, suggestion: best.game };

  return { game: null, suggestion: null };
}

// -------------------------------------------------------------
// HTTP & PROXY
// -------------------------------------------------------------
async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
  const reqConfig = { method, url, timeout: options.timeout || 15000, headers: { "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)], ...options.headers } };
  if (options.data) reqConfig.data = options.data;
  for (let i = 0; i <= retries; i++) {
    try { return await axios(reqConfig); } 
    catch (err) {
      const status = err.response?.status || "N/A";
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) throw err;

      if (i === retries) {
        logger("ERROR", "HTTP", `Eșec final request [${status}] după ${retries} încercări: ${url}`, err.message);
        throw err;
      }
      logger("WARN", "HTTP", `Eșec request [${status}] (încercarea ${i + 1}/${retries}), reîncerc în ${backoff}ms: ${url}`, err.message);
      await new Promise(res => setTimeout(res, backoff)); backoff *= 2;
    }
  }
}

async function fetchWithProxy(targetUrl, options = {}) {
  const proxies = [`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`];
  let lastErr;
  for (const proxy of proxies) {
    try {
      const res = await httpReq('GET', proxy, options);
      return proxy.includes("allorigins") ? String(res?.data?.contents || "") : (typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
    } catch (err) { lastErr = err; }
  }
  throw new Error(`Proxy fallback epuizat: ${lastErr?.message}`);
}

// -------------------------------------------------------------
// FUNCȚII SCRAPING
// -------------------------------------------------------------
function absoluteUrl(base, maybeRelative) { try { return new URL(maybeRelative, base).href; } catch { return ""; } }
function isGoodSteamArticleUrl(url) { const v = String(url || "").trim().toLowerCase(); return !(!v || !v.startsWith("http") || v.includes("steamstatic") || v.includes("steamcdn")); }
function extractDateScore(url) { const u = url.toLowerCase(); const m1 = u.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/); if (m1) { const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}`); if (!isNaN(d.getTime())) return d.getTime(); } return 0; }
function scoreCandidate(candidate, keywords) { const haystack = `${candidate.href} ${candidate.text}`.toLowerCase(); let score = 0; for (const k of keywords) if (haystack.includes(String(k).toLowerCase())) score += 1; return score; }

function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()) : [];
  const text = `${title} ${contents}`;

  const badWordsInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
  if (badWordsInTitle.some((word) => title.includes(word))) return false;
  if (tags.includes("patchnotes") || tags.includes("update")) return true;

  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];
  return goodWords.some((word) => text.includes(word));
}

async function fetchSteamUpdate(game) {
  const response = await httpReq('GET', `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`);
  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter(item => (item.feed_type === 1 || item.feedname === "steam_community_announcements") && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  if (!patchNotes.length) throw new Error("Lipsă patch notes Steam valabile.");
  const latest = patchNotes[0];
  const rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[.*?\]/g, " ");
  return normalizeUpdate({ id: String(latest.gid), title: cleanText(latest.title), link: String(latest.url), excerpt: rawContents, fullText: rawContents, timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : "" });
}

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length ? game.listingUrls : [game.listingUrl];
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;
  let collected = [];

  for (const url of listingUrls) {
    try {
      const listRes = await httpReq('GET', url);
      const $ = cheerio.load(String(listRes.data));
      let position = 0;
      $('a').each((i, el) => {
        const href = absoluteUrl(game.baseUrl, $(el).attr('href'));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        const candidate = { href, text: cleanText($(el).text()), position: position++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) {
      logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, err.message);
    }
  }

  const seen = new Set();
  const unique = collected.filter(item => { if (!item.href || seen.has(item.href)) return false; seen.add(item.href); return true; });
  unique.sort((a, b) => { 
    if (keywords.length) { const s = scoreCandidate(b, keywords) - scoreCandidate(a, keywords); if(s!==0) return s; }
    const d = extractDateScore(b.href) - extractDateScore(a.href); if(d!==0) return d;
    return a.position - b.position; 
  });

  if (!unique.length) throw new Error(`Nu am găsit ancore valide.`);
  const articleUrl = unique[0].href;
  const articleRes = await httpReq('GET', articleUrl);
  const $art = cheerio.load(String(articleRes.data || ""));

  const ogTitle = $art('meta[property="og:title"]').attr('content') || $art('title').text() || "";
  const ogDesc = $art('meta[property="og:description"]').attr('content') || "";
  $art('script, style, nav, footer, header').remove();
  const rawContent = $art('article').text() || $art('main').text() || $art('body').text();

  return normalizeUpdate({ id: String(articleUrl), title: cleanText(ogTitle) || `${game.name} Update`, link: articleUrl, excerpt: cleanText(ogDesc), fullText: cleanText(rawContent), thumbnail: game.thumbnail });
}

async function fetchFortniteUpdate() {
  try {
    const posts = JSON.parse(await fetchWithProxy("https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US", { timeout: 15000 }) || "{}")?.blogList;
    const valid = (posts || []).filter(p => p.slug && p.slug.toLowerCase() !== "news");
    if (!valid.length) throw new Error("Nu am găsit postări valide");
    const latest = valid.find(p => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];
    return normalizeUpdate({ id: String(latest.slug), title: cleanText(latest.title), link: `https://www.fortnite.com/news/${latest.slug}`, excerpt: cleanText(latest.shareDescription), thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: latest.date });
  } catch (err) {
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString((await httpReq('GET', backupUrl)).data);
    if (!feed.items || feed.items.length === 0) throw new Error("Eșec total Fortnite.");
    return normalizeUpdate({ id: feed.items[0].link, title: cleanText(feed.items[0].title), link: feed.items[0].link, excerpt: "Update oficial Fortnite.", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: feed.items[0].pubDate });
  }
}

async function fetchAmdUpdate(game) {
  try {
    const rawContent = await fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
    const match = rawContent.match(/Adrenalin Edition\s+([\d\.]+)/i);
    if (match) return normalizeUpdate({ id: match[1], title: `AMD Radeon Adrenalin v${match[1]}`, link: "https://www.amd.com", excerpt: "Driver disponibil.", thumbnail: game.thumbnail });
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare AMD proxy", err.message);
  }
  const res = await httpReq('GET', `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec AMD.");
  return normalizeUpdate({ id: cleanText(feed.items[0].title), title: cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update AMD.com.", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchIntelUpdate(game) {
  try {
    const rawContent = await fetchWithProxy(game.url);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (match) return normalizeUpdate({ id: match[1], title: `${game.name} v${match[1]}`, link: game.url, excerpt: `Versiune găsită: ${match[1]}`, thumbnail: game.thumbnail });
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare Intel proxy", err.message);
  }
  const q = game.key === "intelpro" ? 'site:intel.com "Intel Arc Pro Graphics"' : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const res = await httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec Intel.");
  return normalizeUpdate({ id: cleanText(feed.items[0].title), title: cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update intel.com detectat.", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchMinecraftUpdate() { 
  const r = await httpReq('GET', "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"); 
  const v = r?.data?.latest?.release; 
  if(!v) throw new Error("Lipsă versiune JSON"); 
  return normalizeUpdate({ id: v, title: `Minecraft ${v}`, link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`, excerpt: `Versiunea ${v}`, thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg" }); 
}

async function fetchRobloxUpdate() { 
  const r = await httpReq('GET', "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer"); 
  const v = r?.data?.clientVersionUpload; 
  if(!v) throw new Error("Lipsă versiune API"); 
  return normalizeUpdate({ id: String(v), title: "Roblox Update", link: "https://en.help.roblox.com/hc/en-us", excerpt: `Versiunea ${v}`, thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg" }); 
}

async function fetchNvidiaUpdate(g) { 
  const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"'; 
  const r = await httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`); 
  const f = await rssParser.parseString(r.data); 
  if (!f.items || f.items.length === 0) throw new Error("Eșec Nvidia.");
  return normalizeUpdate({ id: f.items[0].link, title: cleanText(f.items[0].title).split(" - ")[0], link: f.items[0].link, thumbnail: g.thumbnail }); 
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL ȘI REDUCERI 
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

  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) return { game, latest: null, error: "Circuit Breaker Activ" };

  try {
    const latest = await fetchGameUpdate(game);
    if (cb.fails > 0 || cb.cooldownUntil) { cb.fails = 0; cb.cooldownUntil = null; await cb.save(); }
    return { game, latest, error: null };
  } catch (error) {
    cb.fails += 1;
    if (cb.fails >= 5) cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000); 
    await cb.save();
    return { game, latest: null, error: error.message };
  }
}

async function getLatestForAllGames() {
  const results = [];
  for (let i = 0; i < config.games.length; i += FETCH_CONCURRENCY) {
    const chunk = config.games.slice(i, i + FETCH_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (game) => await executeFetchWithCircuitBreaker(game)));
    results.push(...chunkResults);
  }
  return results;
}

async function fetchSteamReviewData(appId) {
  try {
    const res = await httpReq('GET', `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`);
    const summary = res.data?.query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
      return { totalReviews, qualityPercent };
    }
  } catch (err) {
    logger("WARN", "STEAM_REVIEW", `Eroare preluare review Steam appID ${appId}`, err.message);
  }
  return { totalReviews: 0, qualityPercent: 0 };
}

const activeEnrichments = new Map();

async function enrichDealData(deal) {
  if (deal.enriched) return deal; 

  if (activeEnrichments.has(deal.id)) {
    return activeEnrichments.get(deal.id);
  }

  const enrichTask = (async () => {
    if (deal.store === "Steam" && deal.steamAppID) {
      try {
        const res = await httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}&cc=US&l=english`, { timeout: 5000 });
        const data = res.data[deal.steamAppID]?.data;
        if (data && data.platforms) deal.extraDetails += `\n**Platforme:** ${[data.platforms.windows ? "Win" : "", data.platforms.mac ? "Mac" : "", data.platforms.linux ? "Lin" : ""].filter(Boolean).join(", ")}`;
        const htmlRes = await httpReq('GET', deal.link, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
        const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
        if (match && match[1]) deal.endDateStr = match[1].trim();
      } catch (e) {
        logger("WARN", "STEAM_ENRICH", `Eroare enrich oferta Steam appID ${deal.steamAppID}`, e.message);
      }
    }
    deal.enriched = true;
    return deal;
  })();

  activeEnrichments.set(deal.id, enrichTask);
  try {
    await enrichTask;
  } finally {
    activeEnrichments.delete(deal.id);
  }

  return deal;
}

async function fetchDeals() {
  const deals = [];

  // --- 1. PRELUARE OFERTE STEAM VIA API INTERN ---
  try {
    const steamRes = await httpReq('GET', 'https://store.steampowered.com/api/featuredcategories/?cc=US&l=english');
    const steamSpecials = (steamRes.data?.specials?.items || []).slice(0, 30);

    const reviewsData = [];
    for (let i = 0; i < steamSpecials.length; i += 5) {
      const chunk = steamSpecials.slice(i, i + 5);
      const chunkPromises = chunk.map(item => fetchSteamReviewData(item.id));
      const chunkResults = await Promise.all(chunkPromises);
      reviewsData.push(...chunkResults);
      await new Promise(res => setTimeout(res, 500));
    }

    for (let i = 0; i < steamSpecials.length; i++) {
      const item = steamSpecials[i];
      const revData = reviewsData[i];
      const normalPrice = (item.original_price / 100).toFixed(2);
      const salePrice = (item.final_price / 100).toFixed(2);
      const savings = item.discount_percent || 0;

      const wSavings = savings * 0.8;
      const wQuality = revData.qualityPercent * 1.0;
      const wBonus = Math.min(25, Math.floor(revData.totalReviews / 1000));
      const hybridScore = wSavings + wQuality + wBonus;

      deals.push({
        id: `steam_${item.id}`,
        steamAppID: item.id,
        title: item.name,
        salePrice: salePrice,
        normalPrice: normalPrice,
        savings: savings,
        store: "Steam",
        link: `https://store.steampowered.com/app/${item.id}`,
        popularityScore: hybridScore,
        totalReviews: revData.totalReviews,
        qualityScore: revData.qualityPercent,
        endDateStr: "Nespecificat",
        extraDetails: "",
        enriched: false, 
        thumbnail: item.header_image || null
      });
    }
  } catch (err) { logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message); }

  // --- 2. PRELUARE OFERTE EPIC GAMES VIA GRAPHQL ---
  try {
    const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;

    const epicVars = {
      category: "games/edition/base|bundles/games",
      count: 20, 
      country: "US",
      locale: "en-US",
      onSale: true,
      withPrice: true
    };

    const epicRes = await httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: epicVars } });
    const epicElements = epicRes.data?.data?.Catalog?.searchStore?.elements || [];

    for (const item of epicElements) {
      const priceInfo = item.price?.totalPrice;
      if (!priceInfo) continue;

      const normalPrice = (priceInfo.originalPrice / 100).toFixed(2);
      const salePrice = (priceInfo.discountPrice / 100).toFixed(2);

      let savings = 0;
      if (priceInfo.originalPrice > 0) savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);

      const wSavings = savings * 0.8;
      const hybridScore = wSavings + 80.0 + 15.0;

      let thumb = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
        if (img) thumb = img.url;
      }

      let endDate = "Nespecificat";
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) endDate = new Date(promos.endDate).toLocaleDateString('ro-RO');

      const urlSlug = item.urlSlug || item.id;

      deals.push({
        id: `epic_${item.id}`,
        steamAppID: null,
        title: item.title,
        salePrice: salePrice,
        normalPrice: normalPrice,
        savings: savings,
        store: "Epic Games",
        link: `https://store.epicgames.com/en-US/p/${urlSlug}`,
        popularityScore: hybridScore,
        totalReviews: 0,
        qualityScore: 80,
        endDateStr: endDate,
        extraDetails: "",
        enriched: true,
        thumbnail: thumb
      });
    }
  } catch (err) { logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL", err.message); }

  // --- 3. SORTARE ȘI RETURNARE ---
  const finalTop = deals.sort((a, b) => b.popularityScore - a.popularityScore).slice(0, MAX_DEALS);
  if (!finalTop.length) throw new Error("Fără oferte valide.");
  return finalTop;
}

// -------------------------------------------------------------
// HELPERE PENTRU CĂUTAREA PREȚURILOR ȘI DLC-urilor PE STEAM
// -------------------------------------------------------------
async function searchSteamGameByName(query) {
  const searchRes = await httpReq('GET', `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=english`);
  return searchRes.data?.items || [];
}

function chooseBestSteamMatch(items, query) {
  const normalize = (str) => String(str).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') 
    .replace(/\s+/g, ' ')         
    .trim();

  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);

  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
  const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));

  const extraTypes = new Set(["dlc", "demo", "music"]);

  let bestMatch = items[0];
  let bestScore = Infinity;

  for (const item of items) {
    const itemName = String(item.name || "").toLowerCase();
    const normItemName = normalize(itemName);

    let score = levenshtein(normTarget, normItemName);

    if (normItemName === normTarget) score -= 100;
    else if (normItemName.startsWith(normTarget)) score -= 20;
    else if (normItemName.includes(normTarget)) score -= 10;

    if (!wantsDLC) {
      const isExtraByName = dlcKeywords.some(kw => itemName.includes(kw));
      const isExtraByType = typeof item.type === "string" && extraTypes.has(item.type.toLowerCase());

      if (isExtraByName || isExtraByType) {
        score += 50; 
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch; 
}

async function fetchSteamPriceDetails(appId) {
  const detailsRes = await httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`);
  return detailsRes.data[appId]?.data || null;
}

async function extractSteamOfferEndDate(appId) {
  try {
    const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${appId}`, {
      headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
    });
    const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
    return match && match[1] ? match[1].trim() : null;
  } catch (err) {
    logger("WARN", "PRICE_SEARCH", `Nu am putut extrage data expirării pentru app ${appId}`, err.message);
    return null;
  }
}

function buildSteamPriceEmbed(gameData, appId, offerEndDate) {
  const typeStr = gameData.type === 'game' ? 'Joc' :
                  gameData.type === 'dlc' ? 'DLC / Extensie' :
                  gameData.type === 'music' ? 'Coloană Sonoră' :
                  gameData.type === 'demo' ? 'Demo' : 'Aplicație/Bundle';

  const title = gameData.name;
  const isFree = gameData.is_free;
  const priceOverview = gameData.price_overview;

  let embedDesc = `**Tip produs:** ${typeStr}\n\n`;
  let color = 0x2b2d31;

  if (isFree) {
    embedDesc += `Acest titlu este în prezent **GRATUIT** (Free to Play).`;
    color = 0xffd700;
  } else if (!priceOverview) {
    embedDesc += `Prețul nu este disponibil în acest moment (posibil să nu fi fost lansat încă sau să nu poată fi cumpărat direct).`;
  } else {
    const normalPrice = (priceOverview.initial / 100).toFixed(2);
    const currentPrice = (priceOverview.final / 100).toFixed(2);
    const discountPercent = priceOverview.discount_percent;

    if (discountPercent > 0) {
      embedDesc += `Este o reducere activă de **${discountPercent}%**!\n\n~~$${normalPrice}~~ -> **$${currentPrice}**`;
      color = 0xe74c3c;
      if (offerEndDate) {
        embedDesc += `\n⏳ **Oferta expiră la:** ${offerEndDate}`;
      } else {
        embedDesc += `\n⏳ **Oferta expiră la:** Nespecificat (posibil ofertă permanentă sau bundle).`;
      }
    } else {
      embedDesc += `Nu este la reducere în acest moment.\n\nPreț standard: **$${normalPrice}**`;
      color = 0x57f287;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🏷️ Preț curent pe Steam: ${title}`)
    .setURL(`https://store.steampowered.com/app/${appId}`)
    .setDescription(embedDesc);

  if (gameData.header_image) {
    embed.setImage(gameData.header_image);
  }

  return embed;
}

// -------------------------------------------------------------
// STATUS SERVERE
// -------------------------------------------------------------
async function fetchGameStatus(game) {
  let statusText = "Acest joc nu are un API de status public și oficial integrat în bot. Te rugăm să verifici paginile oficiale de comunitate.";
  let statusLink = "";
  let homepageLink = "";
  let color = 0x3498db; 

  if (game.type === "epic_games") {
    try {
      const res = await httpReq("GET", "https://status.epicgames.com/api/v2/status.json");
      statusText = `**Status Server:** ${res.data.status.description}`;
      statusLink = "https://status.epicgames.com/";
      color = res.data.status.indicator === "none" ? 0x2ecc71 : 0xe74c3c;
    } catch (e) {
      statusText = "Eroare la preluarea statusului automat. Te rugăm să verifici pagina oficială.";
      statusLink = "https://status.epicgames.com/";
    }
  } else if (game.key === "roblox") {
    statusLink = "https://status.roblox.com/";
    statusText = "Apasă pe linkul de mai jos pentru a vedea starea oficială Roblox.";
  } else if (game.key === "valorant" || game.key === "lol") {
    statusLink = "https://status.riotgames.com/";
    statusText = "Apasă pe linkul de mai jos pentru a vedea starea oficială Riot Games.";
  } else if (game.key === "minecraft") {
    statusLink = "https://help.minecraft.net/hc/en-us/articles/360052646271-Minecraft-Server-Status";
  } else {
    homepageLink = game.url || game.baseUrl || "Nu este disponibil un link oficial.";
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📡 Status Servere: ${game.name}`)
    .setDescription(statusText);

  if (statusLink && statusLink.startsWith("http")) {
    embed.addFields({ name: "🔗 Pagină Oficială de Status", value: `[Verifică Statusul Aici](${statusLink})` });
  } else if (homepageLink && homepageLink.startsWith("http")) {
    embed.addFields({ name: "🏠 Pagină Principală / Fallback", value: `[Accesează Homepage](${homepageLink})\n*(Acesta este link-ul general al jocului/producătorului, nu o pagină automată de status)*` });
  }

  if (game.thumbnail) embed.setThumbnail(game.thumbnail);

  return embed;
}

// -------------------------------------------------------------
// FUNCȚII CRON JOB (Verificare automată pentru mesaje pe canale)
// -------------------------------------------------------------
async function checkForUpdates() {
  const guilds = await GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } }).lean();
  if (!guilds.length) return;

  const results = await getLatestForAllGames();
  const validResults = results.filter(r => r.latest !== null);
  if (!validResults.length) return;

  for (const guild of guilds) {
    let channel;
    try {
      channel = await client.channels.fetch(guild.notificationChannelId);
    } catch (err) { continue; } 

    if (!canSendEmbeds(channel, client.user.id)) continue;

    let updatePayload = {};
    if (!guild.seen) guild.seen = {}; 
    let sentUpdatesCount = 0; 

    for (const { game, latest } of validResults) {
      const seenIds = Array.isArray(guild.seen[game.key]) ? [...guild.seen[game.key]] : [];

      if (!seenIds.includes(latest.id)) {
        if (sentUpdatesCount < 5) { 
          const embed = buildUpdateEmbed(game.name, latest, guild.notificationMode || "detailed");
          try {
            await channel.send({ content: `🔔 A apărut un update nou pentru **${game.name}**!`, embeds: [embed] });
            await new Promise(r => setTimeout(r, 800)); 

            sentUpdatesCount++;
            seenIds.push(latest.id);
            if (seenIds.length > 20) seenIds.shift();

            guild.seen[game.key] = seenIds;
            updatePayload[`seen.${game.key}`] = seenIds; 

            await GuildModel.updateOne({ _id: guild._id }, { $set: updatePayload });
          } catch (err) {
            logger("WARN", "CRON_UPDATES", `Eroare la trimitere pe canal ${channel.id}`, err.message);
          }
        } else {
           seenIds.push(latest.id);
           if (seenIds.length > 20) seenIds.shift();

           guild.seen[game.key] = seenIds;
           updatePayload[`seen.${game.key}`] = seenIds;
           await GuildModel.updateOne({ _id: guild._id }, { $set: updatePayload });
        }
      }
    }
  }
}

async function checkForDiscounts() {
  const guilds = await GuildModel.find({ discountsSubscribed: true, discountChannelId: { $ne: null } }).lean();
  if (!guilds.length) return;

  let deals;
  try {
    deals = await fetchDeals();
  } catch (err) { return logger("WARN", "CRON_DISCOUNTS", "Eroare fetch oferte cron", err.message); }

  for (const guild of guilds) {
    let channel;
    try {
      channel = await client.channels.fetch(guild.discountChannelId);
    } catch (err) { continue; }

    if (!canSendEmbeds(channel, client.user.id)) continue;

    const minDisc = guild.minDiscountPercent || 0;
    const incFree = guild.includeFreeGames !== false;
    const incPaid = guild.includePaidDiscounts !== false;

    const filteredDeals = deals.filter(deal => {
      const isFree = parseFloat(deal.salePrice) === 0;
      if (isFree && !incFree) return false;
      if (!isFree && !incPaid) return false;
      if (!isFree && deal.savings < minDisc) return false;
      return true;
    });

    let sentCount = 0;
    if (!guild.seenDiscounts) guild.seenDiscounts = [];

    for (const deal of filteredDeals) {
      const hash = crypto.createHash('sha1').update(`${deal.title}_${deal.store}_${deal.salePrice}_${deal.normalPrice}`).digest('hex');

      if (!guild.seenDiscounts.includes(hash)) {
        if (sentCount < 8) { 
          try { await enrichDealData(deal); } catch (e) { } 
          const embed = buildDealEmbed(deal, guild.notificationMode || "detailed");
          try {
            await channel.send({ content: `🔥 Ofertă nouă detectată!`, embeds: [embed] });
            await new Promise(r => setTimeout(r, 800)); 

            sentCount++;
            guild.seenDiscounts.push(hash); 
            if (guild.seenDiscounts.length > DEALS_HISTORY_LIMIT) guild.seenDiscounts.shift();

            await GuildModel.updateOne({ _id: guild._id }, { $set: { seenDiscounts: guild.seenDiscounts } });
          } catch (err) {
            logger("WARN", "CRON_DISCOUNTS", `Eroare trimitere oferte canal ${channel.id}`, err.message);
          }
        } else {
           guild.seenDiscounts.push(hash);
           if (guild.seenDiscounts.length > DEALS_HISTORY_LIMIT) guild.seenDiscounts.shift();
           await GuildModel.updateOne({ _id: guild._id }, { $set: { seenDiscounts: guild.seenDiscounts } });
        }
      }
    }
  }
}

// -------------------------------------------------------------
// COMMAND HANDLERS 
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un admin.");

  if (subCommand === "updates") {
    const msg = await message.reply("⏳ Setez canalul...");
    try {
      const results = await getLatestForAllGames();
      const setPayload = { subscribed: true, notificationChannelId: message.channel.id };
      for (const r of results) if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
      await GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });
      return msg.edit("✅ Update-uri automate activate.");
    } catch (err) { return msg.edit(formatUserError(err, "Eroare la inițializarea datelor.")); }
  } 
  if (subCommand === "reduceri") {
    const msg = await message.reply("⏳ Setez canalul oferte...");
    try {
      const deals = await fetchDeals(); 
      const initHashes = deals.map(d => crypto.createHash('sha1').update(`${d.title}_${d.store}_${d.salePrice}_${d.normalPrice}`).digest('hex')).slice(-DEALS_HISTORY_LIMIT);
      await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: true, discountChannelId: message.channel.id, seenDiscounts: initHashes } }, { upsert: true });
      return msg.edit("✅ Alertele reduceri activate!");
    } catch (err) { return msg.edit(formatUserError(err, "Eroare internă la preluarea ofertelor.")); }
  }
  return message.reply(`❌ Sintaxă: \`${PREFIX}start updates\` sau \`${PREFIX}start reduceri\`.`);
}

async function handleStop(message, subCommand, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un admin.");
  try {
    if (subCommand === "updates") { await GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false, notificationChannelId: null } }); return message.reply("🛑 Update-uri oprite."); }
    if (subCommand === "reduceri") { await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false, discountChannelId: null } }); return message.reply("🛑 Reduceri oprite."); }
  } catch (err) { return message.reply(formatUserError(err, "Eroare la baza de date.")); }
  return message.reply(`❌ Sintaxă: \`${PREFIX}stop updates\` sau \`${PREFIX}stop reduceri\`.`);
}

async function handleSetCommand(message, args, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar admin.");
  const setting = (args[0] || "").toLowerCase();
  const value = (args[1] || "").toLowerCase();

  if (!setting || !value) return message.reply(`⚙️ Setări: mode, mindiscount, free, paid.`);

  const updateDoc = {};
  let confirmMsg = "";

  switch (setting) {
    case "mode":
      if (!["compact", "detailed"].includes(value)) return message.reply("❌ Permise: `compact` sau `detailed`.");
      updateDoc.notificationMode = value; confirmMsg = `✅ Mod setat: **${value}**`; break;
    case "mindiscount":
      const min = parseInt(value);
      if (isNaN(min) || min < 0 || min > 100) return message.reply("❌ 0-100.");
      updateDoc.minDiscountPercent = min; confirmMsg = `✅ Reducere minimă: **${min}%**`; break;
    case "free":
      if (!["on", "off"].includes(value)) return message.reply("❌ `on` / `off`.");
      updateDoc.includeFreeGames = value === "on"; confirmMsg = `✅ Jocuri free: **${value.toUpperCase()}**`; break;
    case "paid":
      if (!["on", "off"].includes(value)) return message.reply("❌ `on` / `off`.");
      updateDoc.includePaidDiscounts = value === "on"; confirmMsg = `✅ Oferte plătite: **${value.toUpperCase()}**`; break;
    default: return message.reply("❌ Setare necunoscută.");
  }
  try { await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true }); return message.reply(confirmMsg); } 
  catch (err) { return message.reply(formatUserError(err, "Eroare la salvarea preferințelor.")); }
}

async function handleLatestUpdates(message) {
  let msg = null;
  if (!cache.updates.data) {
    const estMs = (await getSystemTimes()).all || 35000;
    msg = await message.reply(`⏳ *Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
        const results = await getLatestForAllGames();
        cache.updates = { data: results, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes(); sys.all = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "Nu am reușit să obțin update-urile.")); }
  }
  const valid = cache.updates.data.filter(r => r.latest !== null);
  if (!valid.length) return msg ? msg.edit("❌ Nu am date disponibile.") : message.reply("❌ Nu am date disponibile.");

  const guild = await GuildModel.findById(message.guild.id).lean();
  const mode = guild?.notificationMode || "detailed";
  if (msg) await msg.edit("✅ Date încărcate!");
  else msg = await message.reply("✅ Date încărcate!");

  const generateEmbeds = async (page, totalP, currentMode) => valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r => buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} • Pagina ${page + 1}/${totalP}` }));
  await handlePagination(msg, message.author.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestDeals(message) {
  let msg = null;
  if (!cache.deals.data) {
    const estMs = (await getSystemTimes()).reduceri || 10000;
    msg = await message.reply(`⏳ *Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
        const rawDeals = await fetchDeals();
        cache.deals = { data: rawDeals, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes(); sys.reduceri = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "Nu am putut interoga magazinele.")); }
  }

  const guild = await GuildModel.findById(message.guild.id).lean();
  const mode = guild?.notificationMode || "detailed";

  const minDisc = guild?.minDiscountPercent || 0;
  const incFree = guild?.includeFreeGames !== false;
  const incPaid = guild?.includePaidDiscounts !== false;

  const top = cache.deals.data.filter(deal => {
    const isFree = parseFloat(deal.salePrice) === 0;
    if (isFree && !incFree) return false;
    if (!isFree && !incPaid) return false;
    if (!isFree && deal.savings < minDisc) return false;
    return true;
  }).slice(0, MAX_DEALS);

  if (!top.length) return msg ? msg.edit("❌ Nu am găsit oferte care să corespundă setărilor serverului.") : message.reply("❌ Nu am găsit oferte care să corespundă setărilor serverului.");

  if (msg) await msg.edit("✅ Oferte încărcate!");
  else msg = await message.reply("✅ Oferte încărcate!");

  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    if (currentMode !== "compact") { 
      for (const d of chunk) {
        try { await enrichDealData(d); } catch(e) { logger("WARN", "ENRICH", "Eroare enrich command handler", e.message); } 
      }
    }
    return chunk.map(d => buildDealEmbed(d, currentMode).setFooter({ text: `Pagina ${page + 1}/${totalP}` }));
  };
  await handlePagination(msg, message.author.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestSingle(message, gameText) {
  if (!gameText) return message.reply(`❌ Ex: \`${PREFIX}latest update cs2\`.`);
  const estMs = (await getSystemTimes()).single || 2000;
  const loadingMsg = await message.reply(`⏳ *Mă conectez... Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde**.*`);
  const startTime = Date.now();

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) {
    let errText = `❌ Nu am găsit jocul.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
    return loadingMsg.edit(errText).catch(() => null);
  }
  try {
    let latest;
    if (cache.single.has(game.key) && Date.now() < cache.single.get(game.key).expiresAt) {
        const cachedVal = cache.single.get(game.key);
        cache.single.delete(game.key);
        cache.single.set(game.key, cachedVal);
        latest = cachedVal.data;
    } else {
      const res = await executeFetchWithCircuitBreaker(game);
      if (res.error) throw new Error(res.error);
      latest = res.latest;
      cache.single.set(game.key, { data: latest, expiresAt: Date.now() + CACHE_TTL_MS });
      const executionTimes = await getSystemTimes(); executionTimes.single = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(executionTimes);
    }
    const guild = await GuildModel.findById(message.guild.id).lean();
    await loadingMsg.edit({ content: `✅ Update **${game.name}**:`, embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")] }).catch(() => null);
  } catch (error) { 
    await loadingMsg.edit(formatUserError(error, "Nu am putut prelua acest update.")).catch(() => null); 
  }
}

async function handlePriceSearch(message, gameName) {
  if (!gameName) return message.reply(`❌ Trebuie să specifici un joc. Ex: \`${PREFIX}latest pret cyberpunk\`.`);

  const loadingMsg = await message.reply(`⏳ *Caut prețul pe Steam pentru **${gameName}**...*`);

  try {
    let items;
    try {
      items = await searchSteamGameByName(gameName);
    } catch (e) {
      return loadingMsg.edit(`❌ Eroare la conectarea cu serverele Steam. Te rugăm să încerci mai târziu.`).catch(() => null);
    }

    if (!items || items.length === 0) {
      logger("WARN", "PRICE_SEARCH", `Joc negăsit pe Steam pentru query-ul: ${gameName}`);
      return loadingMsg.edit(`❌ Nu am găsit niciun rezultat pe Steam pentru "**${gameName}**".`).catch(() => null);
    }

    const bestMatch = chooseBestSteamMatch(items, gameName);

    if (!bestMatch || !bestMatch.id) {
      return loadingMsg.edit(`❌ Nu am putut selecta un rezultat valid de pe Steam.`).catch(() => null);
    }

    const bestMatchId = bestMatch.id;
    logger("INFO", "PRICE_SEARCH", `Pentru "${gameName}" am selectat ID: ${bestMatchId} (Nume: ${bestMatch.name})`);

    let gameData;
    try {
      gameData = await fetchSteamPriceDetails(bestMatchId);
    } catch (e) {
      return loadingMsg.edit(`❌ Steam API nu a putut returna detaliile pentru acest titlu.`).catch(() => null);
    }

    if (!gameData) {
      logger("WARN", "PRICE_SEARCH", `Detalii indisponibile pentru appID: ${bestMatchId}`);
      return loadingMsg.edit(`❌ Am găsit un rezultat, dar detaliile de preț nu sunt disponibile (posibil blocat regional sau nelistat).`).catch(() => null);
    }

    let offerEndDate = null;
    if (gameData.price_overview && gameData.price_overview.discount_percent > 0) {
      offerEndDate = await extractSteamOfferEndDate(bestMatchId);
    }

    const embed = buildSteamPriceEmbed(gameData, bestMatchId, offerEndDate);
    await loadingMsg.edit({ content: "✅ Am obținut datele de pe Steam!", embeds: [embed] }).catch(() => null);

  } catch (err) {
    await loadingMsg.edit(`❌ A apărut o eroare neașteptată la căutarea prețului.`).catch(() => null);
    logger("ERROR", "PRICE_SEARCH", "Eroare finală nespecificată la căutare preț", err.message);
  }
}

async function handleDlcSearch(message, gameName) {
  if (!gameName) return message.reply(`❌ Trebuie să specifici un joc. Ex: \`${PREFIX}dlc cyberpunk\`.`);

  const loadingMsg = await message.reply(`⏳ *Caut DLC-urile pentru **${gameName}**...*`);

  try {
    let items;
    try {
      items = await searchSteamGameByName(gameName);
    } catch (e) {
      return loadingMsg.edit(`❌ Eroare la conectarea cu serverele Steam.`).catch(() => null);
    }

    if (!items || items.length === 0) {
      return loadingMsg.edit(`❌ Nu am găsit niciun rezultat pe Steam pentru "**${gameName}**".`).catch(() => null);
    }

    let bestMatch = chooseBestSteamMatch(items, gameName);
    if (!bestMatch || !bestMatch.id) {
      return loadingMsg.edit(`❌ Nu am putut selecta un joc valid de pe Steam.`).catch(() => null);
    }

    if (String(bestMatch.type || "").toLowerCase() !== "game") {
      const baseGame = items.find(item => typeof item.type === "string" && item.type.toLowerCase() === "game");
      if (baseGame) {
        bestMatch = baseGame;
        logger("INFO", "DLC_SEARCH", `Fallback la joc de bază pentru query: ${gameName}`);
      }
    }

    const cacheKey = bestMatch.id;
    let dlcData;

    if (cache.dlc.has(cacheKey) && Date.now() < cache.dlc.get(cacheKey).expiresAt) {
      const cachedVal = cache.dlc.get(cacheKey);
      cache.dlc.delete(cacheKey);
      cache.dlc.set(cacheKey, cachedVal); 
      dlcData = cachedVal.data;
    } else {
      const title = bestMatch.name;

      let gameDetails;
      try {
        gameDetails = await fetchSteamPriceDetails(cacheKey);
      } catch (e) {
        logger("WARN", "DLC_SEARCH", `Nu am putut prelua header_image pentru ${cacheKey}`);
      }
      const thumbUrl = gameDetails?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${cacheKey}/header.jpg`;

      const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${cacheKey}`, {
        headers: { "Cookie": "birthtime=283993201; mature_content=1;" },
        timeout: 15000
      });

      const $ = cheerio.load(htmlRes.data);

      if ($('#agegate_box').length > 0 || $('.agegate_text_container').length > 0 || htmlRes.request?.path?.includes('agecheck')) {
        return loadingMsg.edit(`❌ Pagina de Steam pentru **${title}** necesită verificare de vârstă, iar botul nu o poate accesa direct.`).catch(() => null);
      }

      const dlcList = [];
      const seenDlcIds = new Set();

      $('.game_area_dlc_row').each((i, el) => {
        const dlcName = $(el).find('.game_area_dlc_name').text().trim();
        let dlcPrice = $(el).find('.game_area_dlc_price').text().trim();
        const dlcAppId = $(el).attr('data-ds-appid') || dlcName;

        dlcPrice = dlcPrice.replace(/\s+/g, ' ');
        if (!dlcPrice || dlcPrice === "") dlcPrice = "Preț indisponibil";

        if (dlcName && !seenDlcIds.has(dlcAppId)) {
          seenDlcIds.add(dlcAppId);
          dlcList.push({ name: dlcName, price: dlcPrice });
        }
      });

      if (dlcList.length === 0) {
        if ($('.game_area_purchase_game').length === 0) {
            return loadingMsg.edit(`❌ Structura paginii pentru **${title}** nu a putut fi interpretată (posibil regiune blocată sau pachet special).`).catch(() => null);
        }
        return loadingMsg.edit(`❌ Jocul **${title}** nu are niciun DLC listat separat pe magazinul Steam.`).catch(() => null);
      }

      const totalExtracted = dlcList.length;
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: cacheKey, thumbUrl, totalExtracted };
      cache.dlc.set(cacheKey, { data: dlcData, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    const { dlcList, title, appId: finalAppId, thumbUrl: finalThumbUrl, totalExtracted } = dlcData;

    await loadingMsg.edit(`✅ Am găsit **${totalExtracted}** DLC-uri pentru **${title}**!`).catch(() => null);

    const itemsPerPage = 10;
    const generateEmbeds = async (page, totalP) => {
      const chunk = dlcList.slice(page * itemsPerPage, (page + 1) * itemsPerPage);

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6) 
        .setTitle(`📦 DLC-uri: ${title}`)
        .setURL(`https://store.steampowered.com/app/${finalAppId}`)
        .setThumbnail(finalThumbUrl);

      let desc = "";
      chunk.forEach((dlc, index) => {
        const globalIndex = page * itemsPerPage + index + 1;
        desc += `**${globalIndex}. ${truncate(dlc.name, 100)}**\n💵 ${dlc.price}\n\n`;
      });

      embed.setDescription(desc);
      embed.setFooter({ text: `Pagina ${page + 1}/${totalP} • Afișate: ${dlcList.length} / Extrase: ${totalExtracted}` });

      return [embed];
    };

    await handlePagination(loadingMsg, message.author.id, "dlc_cmd", dlcList, itemsPerPage, generateEmbeds, "detailed");

  } catch (err) {
    await loadingMsg.edit(`❌ A apărut o eroare la căutarea DLC-urilor.`).catch(() => null);
    logger("ERROR", "DLC_SEARCH", "Eroare la extragere DLC-uri", err.message);
  }
}

async function handleStatus(message, gameText) {
  if (!gameText) return message.reply(`❌ Trebuie să specifici un joc. Ex: \`${PREFIX}status fortnite\`.`);

  const loadingMsg = await message.reply(`⏳ *Verific statusul serverelor pentru **${gameText}**...*`);

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) {
    let errText = `❌ Nu am găsit jocul în baza mea de date.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
    return loadingMsg.edit(errText).catch(() => null);
  }

  try {
    const embed = await fetchGameStatus(game);
    await loadingMsg.edit({ content: `✅ Informații preluate pentru **${game.name}**:`, embeds: [embed] }).catch(() => null);
  } catch (err) {
    await loadingMsg.edit(`❌ A apărut o eroare la preluarea statusului.`).catch(() => null);
    logger("ERROR", "STATUS", "Eroare la comanda status", err.message);
  }
}

// -------------------------------------------------------------
// INIT 
// -------------------------------------------------------------
let isRunningCron = false; 

client.once("ready", () => {
  logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);

  const runChecks = async () => {
    if (isRunningCron) {
        return logger("WARN", "CRON", "Jobul anterior încă rulează pe această instanță, sar peste ciclul actual.");
    }

    isRunningCron = true;
    cleanCache();

    const lockToken = await acquireDbLock("main_cron_job", 120000);
    if (!lockToken) {
        isRunningCron = false;
        return;
    }

    const hb = setInterval(() => renewDbLock("main_cron_job", lockToken, 120000).catch(()=>{}), 60000);

    try { 
      await checkForUpdates(); 
      await checkForDiscounts(); 
    } catch (err) { 
      logger("ERROR", "CRON", "Eroare loop principal", err.message); 
    } finally { 
      clearInterval(hb); 
      await releaseDbLock("main_cron_job", lockToken); 
      isRunningCron = false;
    }
  };

  runChecks();
  const min = Number(config.checkIntervalMinutes || 30);
  cron.schedule(min === 60 ? '0 * * * *' : `*/${min} * * * *`, runChecks);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const rawContent = message.content.slice(PREFIX.length).trim();
  const rawMatches = rawContent.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const rawArgs = rawMatches.map(arg => arg.replace(/^["']|["']$/g, ''));
  const command = (rawArgs.shift() || "").toLowerCase();
  const subCommand = (rawArgs[0] || "").toLowerCase();

  if (command === "ping") return message.reply("Pong! 🏓");
  if (command === "games" || command === "porecle") {
    const lines = config.games.map(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return item;
    });
    let currentMsg = "🎮 **Jocuri urmărite:**\n";
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
    if (subCommand === "pret") return handlePriceSearch(message, rawArgs.slice(1).join(" "));
    if (subCommand === "update") return handleLatestSingle(message, rawArgs.slice(1).join(" "));
  }

  if (command === "dlc") {
    return handleDlcSearch(message, rawArgs.join(" "));
  }

  if (command === "status") {
    return handleStatus(message, rawArgs.join(" "));
  }

  if (command === "help") {
    const helpEmbed = new EmbedBuilder().setColor(0x2b2d31).setTitle("🤖 Meniul de Ajutor - Big Master")
      .addFields(
        { name: "🛠️ Comenzi Utilitare Generale", value: `\`${PREFIX}ping\`\n\`${PREFIX}games\` (sau \`${PREFIX}porecle\`)` },
        { name: "🔔 Notificări Automate", value: `\`${PREFIX}start updates\`\n\`${PREFIX}stop updates\`\n\`${PREFIX}start reduceri\`\n\`${PREFIX}stop reduceri\`` },
        { name: "⚙️ Preferințe Server", value: `\`${PREFIX}set mode [compact/detailed]\`\n\`${PREFIX}set mindiscount [0-100]\`\n\`${PREFIX}set free [on/off]\`\n\`${PREFIX}set paid [on/off]\`` },
        { name: "🔍 Comenzi Manuale", value: `\`${PREFIX}latest updates\`\n\`${PREFIX}latest reduceri\`\n\`${PREFIX}latest update [poreclă]\`\n\`${PREFIX}latest pret [nume joc]\`\n\`${PREFIX}dlc [nume joc]\`\n\`${PREFIX}status [nume joc]\`` }
      );
    return message.reply({ embeds: [helpEmbed] });
  }
});

async function bootstrap() {
  if (!process.env.MONGO_URI || !process.env.DISCORD_TOKEN) {
    logger("ERROR", "BOOTSTRAP", "Lipsesc variabilele de mediu MONGO_URI sau DISCORD_TOKEN");
    return process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 });
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) { 
    logger("ERROR", "BOOTSTRAP", "Eroare la pornire", err.message);
    process.exit(1); 
  }
}

bootstrap();
