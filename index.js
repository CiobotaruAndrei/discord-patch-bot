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

const CACHE_TTL_MS = 180000; 
const GLOBAL_CACHE_TTL_MS = 1800000; 
const MAX_DEALS = 50;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = 300;

const FETCH_CONCURRENCY = 10;
const MAX_UPDATE_NOTIFICATIONS_PER_CYCLE = 3; 
const MAX_DEAL_NOTIFICATIONS_PER_CYCLE = 5;

const CS_STORE_IDS = {
  STEAM: "1",
  EPIC: "25",
  GOG: "7"
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

function smoothTime(oldMs, newMs, alpha = 0.3) { return Math.round(oldMs * (1 - alpha) + newMs * alpha); }
function safeStringify(value) { try { return JSON.stringify(value); } catch (e) { return String(value); } }

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
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

async function fetchGamesConcurrently(gamesList, concurrency) {
  const results = [];
  for (let i = 0; i < gamesList.length; i += concurrency) {
    const chunk = gamesList.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(async (game) => await executeFetchWithCircuitBreaker(game)));
    results.push(...chunkResults);
  }
  return results;
}

// -------------------------------------------------------------
// 2. VALIDARE CONFIG CU ZOD
// -------------------------------------------------------------
const UpdateSourceSchema = z.object({
  type: z.enum(["steam_news", "official_json", "rss", "manual"]),
  url: z.string().url().optional()
});

const GameSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  appId: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  thumbnail: z.string().url().optional(),
  updateSource: UpdateSourceSchema
}).superRefine((game, ctx) => {
  if (game.updateSource.type === "steam_news" && !game.appId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită appId.` });
  if ((game.updateSource.type === "official_json" || game.updateSource.type === "rss") && !game.updateSource.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită URL.` });
});

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().int().positive().refine(v => [5, 10, 15, 20, 30, 60].includes(v), { message: "Interval invalid." }),
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
  logger("ERROR", "CONFIG", "Eroare validare config", err.issues || err.message);
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

const circuitBreakerSchema = new mongoose.Schema({ _id: String, fails: { type: Number, default: 0 }, cooldownUntil: { type: Date, default: null } }, { minimize: false });
const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({ _id: { type: String, default: "system_state" }, executionTimes: { all: { type: Number, default: 35000 }, single: { type: Number, default: 2000 }, reduceri: { type: Number, default: 10000 } } }, { minimize: false });
const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({ _id: String, lockedUntil: { type: Date, default: null, index: true }, ownerToken: { type: String, default: null } }, { minimize: false });
const JobLockModel = mongoose.model("JobLock", jobLockSchema);
const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
  const now = new Date(); const expires = new Date(now.getTime() + ttlMs); const lockToken = crypto.randomUUID();
  try {
    const lock = await JobLockModel.findOneAndUpdate({ _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] }, { $set: { lockedUntil: expires, ownerToken: lockToken } }, { new: true });
    if (lock && lock.ownerToken === lockToken) { activeLocks.set(jobName, lockToken); return lockToken; }
    try { await JobLockModel.create({ _id: `lock_${jobName}`, lockedUntil: expires, ownerToken: lockToken }); activeLocks.set(jobName, lockToken); return lockToken; } catch (e) { if (e.code === 11000) return null; throw e; }
  } catch (err) { return null; }
}
async function renewDbLock(jobName, token, ttlMs = 120000) { if (!token) return false; try { const res = await JobLockModel.updateOne({ _id: `lock_${jobName}`, ownerToken: token }, { $set: { lockedUntil: new Date(Date.now() + ttlMs) } }); return res.modifiedCount > 0; } catch (err) { return false; } }
async function releaseDbLock(jobName, token) { if (!token) return; try { await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token }); activeLocks.delete(jobName); } catch (err) {} }

async function getSystemTimes() { let sys = await SystemModel.findOneAndUpdate({ _id: "system_state" }, { $setOnInsert: { executionTimes: { all: 35000, single: 2000, reduceri: 10000 } } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean(); return sys.executionTimes || { all: 35000, single: 2000, reduceri: 10000 }; }
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
    if (mongoOk && discordOk) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, mongoOk, discordOk, message: "Online." })); }
    res.writeHead(503, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: false, mongoOk, discordOk, message: "Indisponibil." }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK\n");
}).listen(PORT, "0.0.0.0", () => logger("INFO", "WEB", `Server healthcheck pornit pe portul ${PORT}`));

// -------------------------------------------------------------
// CACHE LRU
// -------------------------------------------------------------
const cache = { updates: { data: null, expiresAt: 0 }, deals: { data: null, expiresAt: 0 }, single: new Map(), dlc: new Map() };
function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) { cache.updates.data = null; cache.updates.expiresAt = 0; }
  if (cache.deals.expiresAt < now) { cache.deals.data = null; cache.deals.expiresAt = 0; }
  for (const [key, value] of cache.single.entries()) { if (value.expiresAt < now) cache.single.delete(key); }
  for (const [key, value] of cache.dlc.entries()) { if (value.expiresAt < now) cache.dlc.delete(key); }
  
  if (cache.dlc.size > 100) { [...cache.dlc.keys()].slice(0, 20).forEach(k => cache.dlc.delete(k)); }
  if (cache.single.size > 100) { [...cache.single.keys()].slice(0, 20).forEach(k => cache.single.delete(k)); }
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE & EMBEDS
// -------------------------------------------------------------
function cleanText(text) { return String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim(); }
function truncate(str, maxLen) { const t = String(str || ""); return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t; }

function normalizeUpdate(data) {
  return { id: String(data.id || ""), title: truncate(data.title || "Update", 250), link: String(data.link || ""), excerpt: truncate(data.excerpt || "", 700), thumbnail: data.thumbnail || null, timestamp: data.timestamp || "" };
}

function buildUpdateEmbed(gameName, latest, mode = "detailed") {
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle(truncate(latest.title, 256)).setFooter({ text: truncate(gameName, 2048) }); 
  if (latest.link) embed.setURL(latest.link);
  
  if (mode === "compact") embed.setDescription(latest.link ? `Apasă pe titlu pentru detalii.` : `Update nou pentru ${gameName}.`);
  else {
    embed.setDescription(truncate(latest.excerpt || `Update nou pentru ${gameName}.`, 4096));
    if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
    if (latest.timestamp) { const d = new Date(latest.timestamp); if (!Number.isNaN(d.getTime())) embed.setTimestamp(d); }
  }
  return embed;
}

function buildDealEmbed(deal, mode = "detailed") {
  const isFree = parseFloat(deal.salePrice) === 0;
  const embed = new EmbedBuilder().setColor(isFree ? 0xffd700 : 0xe74c3c).setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));

  if (mode === "compact") {
    embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? "GRATUIT" : "$" + deal.salePrice}**\n[Vezi oferta](${deal.link})`);
  } else {
    embed.setAuthor({ name: truncate(deal.store, 256) }).setDescription(truncate(`**${deal.store}** oferă o reducere de **${deal.savings}%**!\n\n⭐ **Scor ofertă:** ${deal.popularityScore}/100\n\n`, 4096)).addFields({ name: "Preț Vechi", value: `~~$${deal.normalPrice}~~`, inline: true }, { name: "Preț Nou", value: isFree ? "🔥 GRATUIT 🔥" : `$${deal.salePrice}`, inline: true }, { name: "Link", value: `[Apasă aici](${deal.link})`, inline: false });
    if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
    if (deal.extraDetails) embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails, 1024), inline: false });
  }
  return embed;
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed") {
  if (!items || items.length === 0) return;
  let currentPage = 0; const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = Date.now().toString();

  const updateMessage = async () => {
    try {
      const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
      const components = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_p_${sessionId}`).setLabel("◀ Ant").setStyle(ButtonStyle.Secondary).setDisabled(currentPage <= 0),
        new ButtonBuilder().setCustomId(`${prefix}_n_${sessionId}`).setLabel("Urm ▶").setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1)
      )];
      await interactionMessage.edit({ content: "", embeds, components }).catch(() => null);
    } catch (err) {
      logger("WARN", "PAGINATION", "Eroare la generarea sau editarea mesajului paginat.", err.message);
    }
  };
  await updateMessage();

  const collector = interactionMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) return btn.reply({ content: "Doar autorul comenzii poate naviga!", ephemeral: true }).catch(() => null);
    if (btn.customId === `${prefix}_p_${sessionId}`) currentPage--;
    if (btn.customId === `${prefix}_n_${sessionId}`) currentPage++;
    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));
    await btn.deferUpdate().catch(() => null);
    await updateMessage();
  });
  collector.on("end", () => interactionMessage.editable && interactionMessage.edit({ components: [] }).catch(() => null));
}

function findGameAndSuggestion(text) {
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length < 2) {
    const exact = config.games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }

  let candidates = [];
  for (const game of config.games) {
    const allIdentifiers = [game.key, game.name, ...(game.aliases || [])].map(a => String(a).toLowerCase().replace(/[-_]/g, " "));
    if (allIdentifiers.includes(search)) return { game, suggestion: null };

    let bestDistForGame = Infinity, isStartsWith = false, isIncludes = false;
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
  if (best.dist <= 1 || best.isStartsWith) return { game: best.game, suggestion: null };
  if (best.dist <= dynamicThreshold || best.isIncludes) return { game: null, suggestion: best.game };

  return { game: null, suggestion: null };
}

function chooseBestSteamMatch(items, query) {
  const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);
  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "bundle"];
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
      if (isExtraByName || isExtraByType) score += 50; 
    }

    if (score < bestScore) { bestScore = score; bestMatch = item; }
  }
  return bestMatch; 
}

// -------------------------------------------------------------
// HTTP REQUEST
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

// Helper Proxy pentru cazuri blocate de Cloudflare (ex: Fortnite API)
async function fetchWithProxy(targetUrl, options = {}) {
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, 
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
  ];
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
// RUTER ACTUALIZĂRI (UPDATE SOURCES)
// -------------------------------------------------------------
function isLikelyPatchNote(item) {
  const text = `${item.title || ""} ${item.contents || item.contentSnippet || ""}`.toLowerCase();
  
  // Tag-uri specifice Steam
  const tags = Array.isArray(item.tags) ? item.tags.map(t => String(t).toLowerCase()) : [];
  if (tags.includes("patchnotes") || tags.includes("update")) return true;

  // Verificare titlu
  const title = String(item.title || "").toLowerCase();
  const badWordsInTitle = ["tournament", "merch", "esports", "giveaway", "teaser", "trailer", "preview"];
  if (badWordsInTitle.some(w => title.includes(w))) return false;

  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "notes", "changelog", "season", "driver"];
  return goodWords.some(w => text.includes(w));
}

async function fetchSteamUpdate(game) {
  const res = await httpReq('GET', `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`);
  const notes = (res?.data?.appnews?.newsitems || [])
    .filter(item => {
      const isOfficial = item.feed_type === 1 || item.feedname === "steam_community_announcements";
      const isSteamLink = item.url && (item.url.includes("store.steampowered.com") || item.url.includes("steamcommunity.com"));
      return isOfficial && isSteamLink && isLikelyPatchNote(item);
    })
    .sort((a, b) => b.date - a.date);

  if (!notes.length) throw new Error("Lipsă patch notes Steam valabile.");
  const latest = notes[0];
  const rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[.*?\]/g, " ");

  return normalizeUpdate({ 
    id: String(latest.gid), 
    title: cleanText(latest.title), 
    link: latest.url, 
    excerpt: cleanText(rawContents), 
    thumbnail: game.thumbnail, 
    timestamp: new Date(latest.date * 1000).toISOString() 
  });
}

async function fetchRssUpdate(game) {
  const xmlRes = await httpReq('GET', game.updateSource.url);
  const feed = await rssParser.parseString(String(xmlRes.data));
  
  if (!feed.items || feed.items.length === 0) throw new Error("Feed RSS gol.");
  
  const validItems = feed.items.filter(item => isLikelyPatchNote({ title: item.title, contentSnippet: item.contentSnippet || item.content }));
  if (!validItems.length) throw new Error("Nu am găsit patch notes valide în feed-ul RSS.");
  
  const latest = validItems[0];
  return normalizeUpdate({ id: latest.guid || latest.link, title: cleanText(latest.title), link: latest.link, excerpt: cleanText(latest.contentSnippet || "Update detectat din feed RSS."), thumbnail: game.thumbnail, timestamp: latest.pubDate });
}

async function fetchOfficialJsonUpdate(game) {
  const url = game.updateSource.url;
  
  if (game.key === "fortnite") {
    const rawContent = await fetchWithProxy(url);
    let data = {};
    try { data = JSON.parse(rawContent); } catch(e) { }
    
    const valid = (data?.blogList || []).filter(p => p.slug && p.slug.toLowerCase() !== "news" && /update|patch|\bv\d+/i.test(String(p.title)));
    if (!valid.length) throw new Error("Fără postări valide Fortnite");
    
    return normalizeUpdate({ 
      id: valid[0].slug, 
      title: cleanText(valid[0].title), 
      link: `https://www.fortnite.com/news/${valid[0].slug}`, 
      excerpt: cleanText(valid[0].shareDescription), 
      thumbnail: game.thumbnail, 
      timestamp: valid[0].date 
    });
  }

  const res = await httpReq('GET', url);
  
  if (game.key === "minecraft") {
    const v = res.data?.latest?.release;
    if (!v) throw new Error("Eșec JSON Minecraft");
    return normalizeUpdate({ id: v, title: `Minecraft ${v}`, link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`, excerpt: `Versiunea ${v}`, thumbnail: game.thumbnail });
  }
  
  if (game.key === "roblox") {
    const v = res.data?.clientVersionUpload;
    if (!v) throw new Error("Eșec JSON Roblox");
    // Fallback in caz ca utilizatorul nu schimba pe RSS
    return normalizeUpdate({ id: String(v), title: `Roblox Update`, link: "https://create.roblox.com/docs/release-notes", excerpt: `Versiunea de client detectată: ${v}`, thumbnail: game.thumbnail });
  }
  
  throw new Error("JSON parser necunoscut pentru acest joc.");
}

async function fetchGameUpdate(game) {
  const source = game.updateSource;
  if (!source) throw new Error("Configurare sursă lipsă.");
  switch (source.type) {
    case "steam_news": return await fetchSteamUpdate(game);
    case "rss": return await fetchRssUpdate(game);
    case "official_json": return await fetchOfficialJsonUpdate(game);
    default: throw new Error(`Tip sursă necunoscut: ${source.type}`);
  }
}

async function executeFetchWithCircuitBreaker(game) {
  let cb = await CircuitBreakerModel.findById(game.key) || new CircuitBreakerModel({ _id: game.key });
  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) return { game, latest: null, error: "Circuit Breaker Activ" };

  try {
    const latest = await fetchGameUpdate(game);
    if (cb.fails > 0) { cb.fails = 0; cb.cooldownUntil = null; await cb.save(); }
    return { game, latest, error: null };
  } catch (error) {
    cb.fails += 1;
    if (cb.fails >= 5) cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000); 
    await cb.save();
    return { game, latest: null, error: error.message };
  }
}

// -------------------------------------------------------------
// DEALS (REDUCERI) VIA CHEAPSHARK API
// -------------------------------------------------------------
async function fetchDealsPrimary() {
  try {
    const res = await httpReq('GET', `https://www.cheapshark.com/api/1.0/deals?storeID=${CS_STORE_IDS.STEAM},${CS_STORE_IDS.EPIC}&sortBy=Deal%20Rating&desc=1&onSale=1&pageSize=50`);
    if (!res.data || res.data.length === 0) throw new Error("API gol.");
    
    return res.data.map(d => ({
      id: `cs_${d.dealID}`,
      title: cleanText(d.title),
      salePrice: parseFloat(d.salePrice).toFixed(2),
      normalPrice: parseFloat(d.normalPrice).toFixed(2),
      savings: Math.round(d.savings),
      store: d.storeID === CS_STORE_IDS.STEAM ? "Steam" : (d.storeID === CS_STORE_IDS.EPIC ? "Epic Games" : "Partener Oficial"),
      link: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
      popularityScore: Math.round(parseFloat(d.dealRating) * 10),
      thumbnail: d.thumb,
      extraDetails: `Metacritic: ${d.metacriticScore > 0 ? d.metacriticScore : "N/A"}`
    }));
  } catch (err) { throw new Error("Nu am putut prelua ofertele din API-ul principal."); }
}

// -------------------------------------------------------------
// CRON JOBS ADEVĂRATE
// -------------------------------------------------------------
function getSeenArray(seenContainer, key) {
  const rawSeen = seenContainer instanceof Map ? seenContainer.get(key) : (seenContainer && typeof seenContainer === "object" ? seenContainer[key] : undefined);
  return Array.isArray(rawSeen) ? [...rawSeen] : [];
}

async function checkForUpdates() {
  logger("INFO", "CRON", "Rulare checkForUpdates...");
  try {
    const results = await fetchGamesConcurrently(config.games, FETCH_CONCURRENCY);
    const valid = results.filter(r => r.latest !== null);
    if (!valid.length) return;

    const guilds = await GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } });
    for (const guild of guilds) {
      try {
        const channel = await client.channels.fetch(guild.notificationChannelId).catch(() => null);
        if (!channel) continue;

        let hasChanges = false;
        let updatesSentThisCycle = 0; 

        for (const { game, latest } of valid) {
          if (updatesSentThisCycle >= MAX_UPDATE_NOTIFICATIONS_PER_CYCLE) break; 

          const seenArr = getSeenArray(guild.seen, game.key);
          
          if (!seenArr.includes(latest.id)) {
            const embed = buildUpdateEmbed(game.name, latest, guild.notificationMode);
            const sentMsg = await channel.send({ embeds: [embed] }).catch(() => null);
            
            if (sentMsg) {
              seenArr.push(latest.id);
              if (seenArr.length > 20) seenArr.shift(); 
              guild.seen.set(game.key, seenArr);
              updatesSentThisCycle++;
              hasChanges = true;
            }
          }
        }
        if (hasChanges) await guild.save();
      } catch (err) { logger("WARN", "CRON_UPD", `Eroare guild ${guild._id}`, err.message); }
    }
  } catch (err) { logger("ERROR", "CRON_UPD", "Eroare globală", err.message); }
}

async function checkForDiscounts() {
  logger("INFO", "CRON", "Rulare checkForDiscounts...");
  try {
    const deals = await fetchDealsPrimary();
    if (!deals || !deals.length) return;

    const guilds = await GuildModel.find({ discountsSubscribed: true, discountChannelId: { $ne: null } });
    for (const guild of guilds) {
      try {
        const channel = await client.channels.fetch(guild.discountChannelId).catch(() => null);
        if (!channel) continue;

        let hasChanges = false;
        let dealsSentThisCycle = 0;
        const minDisc = guild.minDiscountPercent || 0;
        const allowFree = guild.includeFreeGames !== false;
        const allowPaid = guild.includePaidDiscounts !== false;

        for (const d of deals) {
          if (dealsSentThisCycle >= MAX_DEAL_NOTIFICATIONS_PER_CYCLE) break;

          const isFree = parseFloat(d.salePrice) === 0;
          if (!allowFree && isFree) continue;
          if (!allowPaid && !isFree) continue;
          if (!isFree && d.savings < minDisc) continue;

          if (!guild.seenDiscounts.includes(d.id)) {
             const embed = buildDealEmbed(d, guild.notificationMode);
             const sentMsg = await channel.send({ embeds: [embed] }).catch(() => null);
             
             if (sentMsg) {
               guild.seenDiscounts.push(d.id);
               dealsSentThisCycle++;
               hasChanges = true;
             }
          }
        }

        if (hasChanges) {
          if (guild.seenDiscounts.length > DEALS_HISTORY_LIMIT) guild.seenDiscounts = guild.seenDiscounts.slice(-DEALS_HISTORY_LIMIT);
          await guild.save();
        }
      } catch (err) { logger("WARN", "CRON_DEALS", `Eroare guild ${guild._id}`, err.message); }
    }
  } catch (err) { logger("ERROR", "CRON_DEALS", "Eroare globală", err.message); }
}

// -------------------------------------------------------------
// COMMAND HANDLERS
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un admin.");
  
  if (subCommand === "updates") {
    const msg = await message.reply("⏳ Setez canalul și pre-încarc datele curente (pre-seed)...");
    try {
      const results = await fetchGamesConcurrently(config.games, FETCH_CONCURRENCY);
      const setPayload = { subscribed: true, notificationChannelId: message.channel.id };
      
      results.forEach(r => {
        if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
      });

      await GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });
      return msg.edit("✅ Update-uri automate activate! Vei primi notificări doar pentru patch-urile noi de acum încolo.");
    } catch (err) { return msg.edit(formatUserError(err, "Eroare la baza de date.")); }
  } 
  
  if (subCommand === "reduceri") {
    const msg = await message.reply("⏳ Setez canalul oferte și pre-încarc datele curente (pre-seed)...");
    try {
      const rawDeals = await fetchDealsPrimary();
      const initHashes = rawDeals.map(d => d.id).slice(-DEALS_HISTORY_LIMIT);
      
      await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: true, discountChannelId: message.channel.id, seenDiscounts: initHashes } }, { upsert: true });
      return msg.edit("✅ Alertele reduceri activate! Vei primi doar ofertele care apar noi de acum încolo.");
    } catch (err) { return msg.edit(formatUserError(err, "Eroare la baza de date.")); }
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

  const updateDoc = {}; let confirmMsg = "";
  switch (setting) {
    case "mode":
      if (!["compact", "detailed"].includes(value)) return message.reply("❌ Permise: `compact` sau `detailed`.");
      updateDoc.notificationMode = value; confirmMsg = `✅ Mod setat: **${value}**`; break;
    case "mindiscount":
      const min = parseInt(value); if (isNaN(min) || min < 0 || min > 100) return message.reply("❌ 0-100.");
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
        const results = await fetchGamesConcurrently(config.games, FETCH_CONCURRENCY);
        cache.updates = { data: results, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes(); sys.all = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "Nu am reușit să obțin update-urile.")); }
  }
  
  const valid = cache.updates.data.filter(r => r.latest !== null);
  if (!valid.length) return msg ? msg.edit("❌ Nu am date disponibile.") : message.reply("❌ Nu am date disponibile.");

  const guild = await GuildModel.findById(message.guild.id).lean();
  if (msg) await msg.edit("✅ Date încărcate!"); else msg = await message.reply("✅ Date încărcate!");
  
  const generateEmbeds = async (page, totalP, currentMode) => valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r => buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} • Pagina ${page + 1}/${totalP}` }));
  await handlePagination(msg, message.author.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, guild?.notificationMode || "detailed");
}

async function handleLatestDeals(message) {
  let msg = null;
  if (!cache.deals.data) {
    const estMs = (await getSystemTimes()).reduceri || 10000;
    msg = await message.reply(`⏳ *Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
        const rawDeals = await fetchDealsPrimary();
        cache.deals = { data: rawDeals, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
        const sys = await getSystemTimes(); sys.reduceri = smoothTime(estMs, Date.now() - startTime); await saveSystemTimes(sys);
    } catch (err) { return msg.edit(formatUserError(err, "Nu am putut interoga ofertele.")); }
  }
  const top = cache.deals.data.slice(0, MAX_DEALS);
  const guild = await GuildModel.findById(message.guild.id).lean();
  if (msg) await msg.edit("✅ Oferte încărcate!"); else msg = await message.reply("✅ Oferte încărcate!");

  const generateEmbeds = async (page, totalP, currentMode) => top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(d => buildDealEmbed(d, currentMode).setFooter({ text: `Pagina ${page + 1}/${totalP}` }));
  await handlePagination(msg, message.author.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, guild?.notificationMode || "detailed");
}

async function handleLatestSingle(message, gameText) {
  if (!gameText) return message.reply(`❌ Ex: \`${PREFIX}latest update cs2\`.`);
  const loadingMsg = await message.reply(`⏳ *Caut update...*`);

  const { game, suggestion } = findGameAndSuggestion(gameText);
  if (!game) return loadingMsg.edit(`❌ Nu am găsit jocul. ${suggestion ? `Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?` : ""}`).catch(() => null);

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
    }
    const guild = await GuildModel.findById(message.guild.id).lean();
    await loadingMsg.edit({ content: `✅ Update **${game.name}**:`, embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")] }).catch(() => null);
  } catch (error) { await loadingMsg.edit(formatUserError(error, "Nu am putut prelua acest update.")).catch(() => null); }
}

async function handlePriceSearch(message, gameName) {
  if (!gameName) return message.reply(`❌ Trebuie să specifici un joc. Ex: \`${PREFIX}latest pret cyberpunk\`.`);
  const loadingMsg = await message.reply(`⏳ *Caut prețul global pentru **${gameName}**...*`);

  try {
    const searchRes = await httpReq('GET', `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameName)}&limit=15`);
    if (!searchRes.data || searchRes.data.length === 0) return loadingMsg.edit(`❌ Nu am găsit rezultate pentru "**${gameName}**".`).catch(() => null);

    const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const normTarget = normalize(gameName);
    let bestMatch = searchRes.data[0];
    let bestDist = Infinity;
    for (const item of searchRes.data) {
      const normItem = normalize(item.external); 
      let dist = levenshtein(normTarget, normItem);
      if (normItem === normTarget) dist -= 100;
      else if (normItem.startsWith(normTarget)) dist -= 20;
      if (dist < bestDist) { bestDist = dist; bestMatch = item; }
    }

    const detailsRes = await httpReq('GET', `https://www.cheapshark.com/api/1.0/games?id=${bestMatch.gameID}`);
    const gameData = detailsRes.data;

    if (!gameData || !gameData.deals || gameData.deals.length === 0) return loadingMsg.edit(`❌ Am găsit jocul, dar nu există oferte disponibile.`).catch(() => null);

    const bestDeal = gameData.deals[0];
    const isFree = parseFloat(bestDeal.price) === 0;

    let embedDesc = `Cea mai bună ofertă globală găsită:\n\n`;
    let color = 0x57f287;
    
    if (isFree) { embedDesc += `🔥 **Acest titlu este în prezent GRATUIT!**`; color = 0xffd700; } 
    else if (parseFloat(bestDeal.savings) > 0) { embedDesc += `Este o reducere activă de **${Math.round(bestDeal.savings)}%**!\n\n~~$${bestDeal.retailPrice}~~ -> **$${bestDeal.price}**`; color = 0xe74c3c; } 
    else { embedDesc += `Nu este la reducere în acest moment.\n\nPreț standard: **$${bestDeal.price}**`; }

    const storeNames = { [CS_STORE_IDS.STEAM]: "Steam", [CS_STORE_IDS.EPIC]: "Epic Games", [CS_STORE_IDS.GOG]: "GOG" };
    const embed = new EmbedBuilder().setColor(color).setTitle(`🏷️ Preț: ${gameData.info.title}`).setURL(`https://www.cheapshark.com/redirect?dealID=${bestDeal.dealID}`).setDescription(embedDesc).addFields({ name: "Magazin", value: storeNames[bestDeal.storeID] || `Magazin ID: ${bestDeal.storeID}`, inline: true }).setThumbnail(gameData.info.thumb);

    await loadingMsg.edit({ content: "✅ Am găsit prețul!", embeds: [embed] }).catch(() => null);
  } catch (err) { await loadingMsg.edit(`❌ Eroare la interogarea API-ului.`).catch(() => null); }
}

async function handleDlcSearch(message, gameName) {
  if (!gameName) return message.reply(`❌ Trebuie să specifici un joc. Ex: \`${PREFIX}dlc cyberpunk\`.`);
  const loadingMsg = await message.reply(`⏳ *Caut DLC-urile pentru **${gameName}**...*`);

  try {
    const searchRes = await httpReq('GET', `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&cc=US&l=english`);
    const items = searchRes.data?.items || [];
    if (!items.length) return loadingMsg.edit(`❌ Nu am găsit niciun rezultat pe Steam pentru "**${gameName}**".`).catch(() => null);

    let bestMatch = chooseBestSteamMatch(items, gameName);
    if (!bestMatch || !bestMatch.id) return loadingMsg.edit(`❌ Nu am putut selecta un joc valid.`).catch(() => null);

    if (String(bestMatch.type || "").toLowerCase() !== "game") {
      const baseGame = items.find(item => typeof item.type === "string" && item.type.toLowerCase() === "game");
      if (baseGame) bestMatch = baseGame;
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
      const htmlRes = await httpReq('GET', `https://store.steampowered.com/app/${cacheKey}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" }, timeout: 15000 });
      const $ = cheerio.load(htmlRes.data);
      
      if ($('#agegate_box').length > 0 || $('.agegate_text_container').length > 0 || htmlRes.request?.path?.includes('agecheck')) {
        return loadingMsg.edit(`❌ Pagina necesită verificare de vârstă, iar botul nu o poate accesa direct.`).catch(() => null);
      }

      const dlcList = [];
      const seenDlcIds = new Set();

      $('.game_area_dlc_row').each((i, el) => {
        const dlcName = $(el).find('.game_area_dlc_name').text().trim();
        let dlcPrice = $(el).find('.game_area_dlc_price').text().trim().replace(/\s+/g, ' ');
        const dlcAppId = $(el).attr('data-ds-appid') || dlcName;
        
        if (!dlcPrice || dlcPrice === "") dlcPrice = "Preț indisponibil";
        if (dlcName && !seenDlcIds.has(dlcAppId)) { seenDlcIds.add(dlcAppId); dlcList.push({ name: dlcName, price: dlcPrice }); }
      });

      if (dlcList.length === 0) {
        if ($('.game_area_purchase_game').length === 0) return loadingMsg.edit(`❌ Structura paginii nu a putut fi interpretată (posibil regiune blocată).`).catch(() => null);
        return loadingMsg.edit(`❌ Jocul nu are niciun DLC listat separat pe magazin.`).catch(() => null);
      }

      const thumbUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${cacheKey}/header.jpg`;
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: cacheKey, totalExtracted: dlcList.length, thumbUrl };
      cache.dlc.set(cacheKey, { data: dlcData, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    await loadingMsg.edit(`✅ Am găsit **${dlcData.totalExtracted}** DLC-uri pentru **${dlcData.title}**!`).catch(() => null);
    const generateEmbeds = async (page, totalP) => {
      const chunk = dlcData.dlcList.slice(page * 10, (page + 1) * 10);
      const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(`📦 DLC-uri: ${dlcData.title}`).setURL(`https://store.steampowered.com/app/${dlcData.appId}`).setThumbnail(dlcData.thumbUrl);
      let desc = "";
      chunk.forEach((dlc, index) => { desc += `**${page * 10 + index + 1}. ${truncate(dlc.name, 100)}**\n💵 ${dlc.price}\n\n`; });
      embed.setDescription(desc).setFooter({ text: `Pagina ${page + 1}/${totalP} • Afișate: ${dlcData.dlcList.length} / Extrase: ${dlcData.totalExtracted}` });
      return [embed];
    };
    await handlePagination(loadingMsg, message.author.id, "dlc_cmd", dlcData.dlcList, 10, generateEmbeds, "detailed");
  } catch (err) { await loadingMsg.edit(`❌ Eroare la extragere DLC-uri.`).catch(() => null); }
}

// -------------------------------------------------------------
// GRACEFUL SHUTDOWN (NOU)
// -------------------------------------------------------------
let isShuttingDown = false;
let heartbeatInterval = null; 

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger("WARN", "SHUTDOWN", `Se oprește procesul (${signal})...`);
  
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  try {
    for (const [jobName, token] of activeLocks.entries()) {
      await releaseDbLock(jobName, token);
    }
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  } catch (err) {
    logger("ERROR", "SHUTDOWN", "Eroare la eliberare resurse", err.message);
  }

  try {
    await client.destroy();
  } catch (e) {
  }

  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------------------------------------------------
// INIT & DISCORD EVENTS
// -------------------------------------------------------------
let isRunningCron = false; 

client.once("ready", () => {
  logger("INFO", "DISCORD", `Bot online: ${client.user.tag}`);
  const runChecks = async () => {
    if (isRunningCron) return; isRunningCron = true;
    cleanCache();
    const lockToken = await acquireDbLock("main_cron_job", 120000);
    if (!lockToken) { isRunningCron = false; return; }
    
    heartbeatInterval = setInterval(() => renewDbLock("main_cron_job", lockToken, 120000).catch(()=>{}), 60000);
    
    try { await checkForUpdates(); await checkForDiscounts(); } 
    catch (err) { logger("ERROR", "CRON", "Eroare loop", err.message); } 
    finally { 
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
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
  const rawArgs = message.content.slice(PREFIX.length).trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(a => a.replace(/^["']|["']$/g, '')) || [];
  const command = (rawArgs.shift() || "").toLowerCase();
  const subCommand = (rawArgs[0] || "").toLowerCase();

  if (command === "ping") return message.reply("Pong! 🏓 Rute optime și protecții active.");
  if (command === "start") return handleStart(message, subCommand, message.guild.id);
  if (command === "stop") return handleStop(message, subCommand, message.guild.id);
  if (command === "set") return handleSetCommand(message, rawArgs, message.guild.id);
  
  if (command === "games" || command === "porecle") {
    const lines = config.games.map(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return item;
    });
    return message.reply(`🎮 **Jocuri urmărite:**\n${lines.join("\n")}`).catch(() => null);
  }

  if (command === "help") {
    const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle("🤖 Meniul de Ajutor - Big Master")
      .addFields(
        { name: "🔔 Notificări Automate", value: `\`${PREFIX}start updates\`\n\`${PREFIX}start reduceri\`\n\`${PREFIX}stop updates\`\n\`${PREFIX}stop reduceri\`` },
        { name: "⚙️ Preferințe Server", value: `\`${PREFIX}set mode [compact/detailed]\`\n\`${PREFIX}set mindiscount [0-100]\`\n\`${PREFIX}set free [on/off]\`\n\`${PREFIX}set paid [on/off]\`` },
        { name: "🔍 Comenzi Manuale", value: `\`${PREFIX}latest updates\`\n\`${PREFIX}latest reduceri\`\n\`${PREFIX}latest update [poreclă]\`\n\`${PREFIX}latest pret [joc]\`\n\`${PREFIX}dlc [joc]\`` }
      );
    return message.reply({ embeds: [embed] });
  }
  
  if (command === "latest") {
    if (subCommand === "updates") return handleLatestUpdates(message);
    if (subCommand === "reduceri") return handleLatestDeals(message);
    if (subCommand === "pret") return handlePriceSearch(message, rawArgs.slice(1).join(" "));
    if (subCommand === "update") return handleLatestSingle(message, rawArgs.slice(1).join(" "));
  }

  if (command === "dlc") return handleDlcSearch(message, rawArgs.join(" "));
});

async function bootstrap() {
  if (!process.env.MONGO_URI || !process.env.DISCORD_TOKEN) return logger("ERROR", "BOOTSTRAP", "Lipsesc ENV_VARS");
  try { await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 }); await client.login(process.env.DISCORD_TOKEN); } 
  catch (err) { logger("ERROR", "BOOTSTRAP", "Eroare la pornire", err.message); process.exit(1); }
}
bootstrap();
