const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
const http = require("http");
const cron = require("node-cron");
const Parser = require("rss-parser");
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

// -------------------------------------------------------------
// 2. VALIDARE CONFIG CU ZOD (Completă și Strictă Logic)
// -------------------------------------------------------------
const GameSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["steam", "intel", "nvidia", "amd", "roblox", "minecraft", "epic_games", "listing_based"]),
  appId: z.string().optional(),
  url: z.string().url().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string()).optional(),
  thumbnail: z.string().url().optional(),
  upCRD: z.number().optional()
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Jocul "${game.name}" necesită listingUrl sau listingUrls.` });
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
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Chei duplicate interzise în config: ${[...new Set(duplicates)].join(', ')}`
      });
    }
  })
});

let config;
try {
  console.log("🛠️ Se citește și se validează config.json cu Zod...");
  const CONFIG_PATH = path.join(__dirname, "config.json");
  const rawData = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  config = ConfigSchema.parse(rawData);
  console.log("✅ Configurația este perfect validă.");
} catch (err) {
  if (err instanceof z.ZodError) {
    console.error("❌ Eroare de validare în config.json:\n", JSON.stringify(err.issues, null, 2));
  } else {
    console.error("❌ Eroare critică la citirea config.json:", err.message);
  }
  process.exit(1);
}

// -------------------------------------------------------------
// 3. SERVER WEB PENTRU RAILWAY HEALTHCHECK
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Bot is running OK\n');
}).listen(PORT, () => console.log(`🌐 Server Healthcheck activat pe portul ${PORT}.`));

// -------------------------------------------------------------
// 4. DEFINIRE SCHEME MONGODB ȘI CLIENT DISCORD
// -------------------------------------------------------------
const guildSchema = new mongoose.Schema({
  _id: String,
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: Map, of: String, default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: [String], default: [] }
}, { minimize: false });

const GuildModel = mongoose.model("Guild", guildSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: {
    all: { type: Number, default: 15000 },
    single: { type: Number, default: 2000 },
    reduceri: { type: Number, default: 15000 }
  }
}, { minimize: false });

const SystemModel = mongoose.model("System", systemSchema);

async function getSystemTimes() {
  let sys = await SystemModel.findById("system_state").lean();
  if (!sys) {
    sys = { _id: "system_state", executionTimes: { all: 15000, single: 2000, reduceri: 15000 } };
    await SystemModel.create(sys);
  }
  return sys.executionTimes;
}

async function saveSystemTimes(times) {
  await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// -------------------------------------------------------------
// 5. SHUTDOWN GRACEFUL & HANDLERE GLOBALE DE ERORI
// -------------------------------------------------------------
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[${signal}] Initiating graceful shutdown...`);
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("✅ MongoDB connection closed.");
    }
    client.destroy();
    console.log("✅ Discord client destroyed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));
process.on("uncaughtException", async (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
  await gracefulShutdown("uncaughtException");
});

// -------------------------------------------------------------
// CACHE & LOCK
// -------------------------------------------------------------
const cache = {
  updates: { data: null, expiresAt: 0 },
  deals: { data: null, expiresAt: 0 },
  single: new Map()
};

let isChecking = false;

function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) cache.updates.data = null;
  if (cache.deals.expiresAt < now) cache.deals.data = null;

  for (const [key, value] of cache.single.entries()) {
    if (value.expiresAt < now) {
      cache.single.delete(key);
    }
  }
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE & NORMALIZARE
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

function normalizeUpdate(data) {
  return {
    id: String(data.id || ""),
    title: String(data.title || "Update nou"),
    link: String(data.link || ""),
    excerpt: String(data.excerpt || "").slice(0, 700),
    fullText: String(data.fullText || "").slice(0, 4000), 
    image: data.image || null,
    thumbnail: data.thumbnail || null,
    timestamp: data.timestamp || ""
  };
}

function absoluteUrl(base, maybeRelative) {
  if (!maybeRelative) return "";
  try { return new URL(maybeRelative, base).href; } catch { return ""; }
}

function isGoodSteamArticleUrl(url) {
  const val = String(url || "").trim().toLowerCase();
  if (!val || !val.startsWith("http") || val.includes("steamstatic") || val.includes("steamcdn")) return false;
  return true;
}

function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()) : [];
  const text = `${title} ${contents}`;

  const badWordsInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway"];
  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes"];

  if (badWordsInTitle.some((word) => title.includes(word))) return false;
  if (tags.includes("patchnotes")) return true;
  return goodWords.some((word) => text.includes(word));
}

function buildUpdateEmbed(gameName, latest) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(latest.title)
    .setDescription(latest.excerpt || `A apărut un nou update pentru ${gameName}.`)
    .setFooter({ text: gameName });

  if (latest.link) embed.setURL(latest.link);
  if (latest.image) embed.setImage(latest.image);
  if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);

  if (latest.timestamp) {
    const date = new Date(latest.timestamp);
    if (!Number.isNaN(date.getTime())) embed.setTimestamp(date);
  }
  return embed;
}

function findGameFromText(text) {
  const search = String(text || "").toLowerCase().trim();
  if (search.length < 2) {
    if (search.length === 1) {
      const exactMatch = config.games.find(g => String(g.key || "").toLowerCase() === search);
      if (exactMatch) return exactMatch;
    }
    return null;
  }

  let bestMatch = null;
  let bestScore = -1;

  for (const game of config.games) {
    const key = String(game.key || "").toLowerCase();
    const name = String(game.name || "").toLowerCase();

    if (key === search || name === search) return game;

    if (name.startsWith(search) || key.startsWith(search)) {
      if (bestScore < 2) { bestScore = 2; bestMatch = game; }
    } else if (name.includes(search) || key.includes(search)) {
      if (bestScore < 1) { bestScore = 1; bestMatch = game; }
    }
  }
  return bestMatch;
}

async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
  const reqConfig = {
    method,
    url,
    timeout: options.timeout || 15000,
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", 
      "Accept-Language": "en-US,en;q=0.9",
      ...options.headers 
    },
  };
  if (options.data) reqConfig.data = options.data;

  for (let i = 0; i <= retries; i++) {
    try {
      return await axios(reqConfig);
    } catch (err) {
      const status = err.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (i === retries) throw err;
      await new Promise(res => setTimeout(res, backoff));
      backoff *= 2;
    }
  }
}

// -------------------------------------------------------------
// FUNCȚII PENTRU DRIVERE ȘI JOCURI 
// -------------------------------------------------------------
async function fetchNvidiaUpdate(game) {
  const exactQuery = game.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${exactQuery} release`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpReq('GET', rssUrl);
  const feed = await rssParser.parseString(res.data);

  if (feed.items && feed.items.length > 0) {
    const latestItem = feed.items[0];
    const rawTitle = cleanText(latestItem.title) || `Update ${game.name}`;
    const cleanT = rawTitle.split(" - ")[0];
    const vMatch = cleanT.match(/\b(\d{3}\.\d{2})\b/);
    const versionStr = vMatch ? `v${vMatch[1]}` : "Update Nou";

    return normalizeUpdate({
      id: cleanT,
      title: `${game.name} ${versionStr}`,
      link: latestItem.link || "https://www.nvidia.com/en-us/geforce/news/",
      excerpt: `Sursa: Sistemul oficial de articole NVIDIA.`,
      fullText: `Sursa: Sistemul oficial de articole NVIDIA. Noul driver ${versionStr} este disponibil.`,
      thumbnail: game.thumbnail,
      timestamp: latestItem.pubDate ? new Date(latestItem.pubDate).toISOString() : ""
    });
  }
  throw new Error(`Nu am putut găsi date pentru ${game.name}.`);
}

async function fetchIntelUpdate(game) {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(game.url)}`;
    const res = await httpReq('GET', proxyUrl);
    const html = String(res?.data?.contents || "");
    const match = html.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);

    if (match) {
      const version = match[1];
      return normalizeUpdate({
        id: version,
        title: `${game.name} v${version}`,
        link: game.url,
        excerpt: `Extras direct de pe pagina oficială Intel.\n**Versiune găsită:** ${version}`,
        fullText: `Extras direct de pe pagina oficială Intel. Versiune nouă detectată: ${version}`,
        thumbnail: game.thumbnail,
        timestamp: ""
      });
    }
  } catch (err) {
    console.warn(`[Driver Fetch] Intel proxy failed pt ${game.name}:`, err.message);
  }

  const q = game.key === "intelpro" ? 'site:intel.com "Intel Arc Pro Graphics"' : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpReq('GET', rssUrl);
  const feed = await rssParser.parseString(res.data);

  if (feed.items && feed.items.length > 0) {
    const latestItem = feed.items[0];
    return normalizeUpdate({
      id: cleanText(latestItem.title),
      title: cleanText(latestItem.title).split(" - ")[0],
      link: latestItem.link,
      excerpt: "Sursa: Sistemul oficial de articole Intel.",
      fullText: "Sursa: Sistemul oficial de articole Intel. Un nou update a fost detectat.",
      thumbnail: game.thumbnail,
      timestamp: latestItem.pubDate ? new Date(latestItem.pubDate).toISOString() : ""
    });
  }
  throw new Error("Acces refuzat la serverele Intel.");
}

async function fetchAmdUpdate(game) {
  try {
    const amdUrl = "https://www.amd.com/en/support/download/drivers.html";
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(amdUrl)}`;
    const res = await httpReq('GET', proxyUrl);
    const match = String(res?.data?.contents || "").match(/Adrenalin Edition\s+([\d\.]+)/i);

    if (match) {
      return normalizeUpdate({
        id: match[1],
        title: `AMD Radeon Adrenalin v${match[1]}`,
        link: amdUrl,
        excerpt: "Scanat direct de pe serverul amd.com. Un nou driver este disponibil.",
        fullText: "Scanat direct de pe serverul amd.com. Un nou driver Adrenalin este disponibil pentru descărcare.",
        thumbnail: game.thumbnail,
        timestamp: ""
      });
    }
  } catch (err) {
    console.warn(`[Driver Fetch] AMD proxy failed pt ${game.name}:`, err.message);
  }

  const rssUrl = `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpReq('GET', rssUrl);
  const feed = await rssParser.parseString(res.data);

  if (feed.items && feed.items.length > 0) {
    const latestItem = feed.items[0];
    return normalizeUpdate({
      id: cleanText(latestItem.title),
      title: cleanText(latestItem.title).split(" - ")[0],
      link: latestItem.link,
      excerpt: "Sursa: Sistemul oficial de articole AMD.",
      fullText: "Sursa: Sistemul oficial de articole AMD. A fost detectat un articol nou cu update-uri.",
      thumbnail: game.thumbnail,
      timestamp: latestItem.pubDate ? new Date(latestItem.pubDate).toISOString() : ""
    });
  }
  throw new Error("Acces refuzat de protecția anti-bot AMD.");
}

async function fetchSteamUpdate(game) {
  const apiUrl = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=100&maxlength=25000&format=json`;
  const response = await httpReq('GET', apiUrl);
  const newsItems = response?.data?.appnews?.newsitems;

  if (!Array.isArray(newsItems) || newsItems.length === 0) throw new Error("Lipsă date Steam.");

  const patchNotes = newsItems.filter(item => {
    if (item.feed_type !== 1 && item.feedname !== "steam_community_announcements") return false;
    if (!isGoodSteamArticleUrl(item.url)) return false;
    return isLikelyPatchNote(item);
  });

  if (patchNotes.length === 0) throw new Error("Niciun update recent detectat direct de pe Steam.");

  patchNotes.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  const latest = patchNotes[0];
  let rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[.*?\]/g, " ");

  return normalizeUpdate({
    id: String(latest.gid),
    title: cleanText(latest.title),
    link: String(latest.url).trim(),
    excerpt: cleanText(rawContents).slice(0, 700) || `A apărut un nou update pentru ${game.name}.`,
    fullText: cleanText(rawContents),
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : ""
  });
}

function extractDateScore(url) {
  const u = url.toLowerCase();
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
  for (const keyword of keywords) {
    if (haystack.includes(String(keyword).toLowerCase())) score += 1;
  }
  return score;
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
        const rawLink = $(el).attr('href');
        if (!rawLink) return;
        const href = absoluteUrl(game.baseUrl, rawLink);
        const text = cleanText($(el).text());
        if (hrefRegex && !hrefRegex.test(href)) return;
        const candidate = { href, text, position: position++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) {
      console.warn(`[Listing Fetch] Eroare la accesarea url-ului de listing pentru ${game.name}:`, err.message);
    }
  }

  const seen = new Set();
  const unique = collected.filter(item => {
    if (!item.href || seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });

  if (keywords.length) {
    unique.sort((a, b) => {
      const scoreDiff = scoreCandidate(b, keywords) - scoreCandidate(a, keywords);
      if (scoreDiff !== 0) return scoreDiff;
      const dateDiff = extractDateScore(b.href) - extractDateScore(a.href);
      if (dateDiff !== 0) return dateDiff;
      return a.position - b.position;
    });
  } else {
    unique.sort((a, b) => {
      const dateDiff = extractDateScore(b.href) - extractDateScore(a.href);
      if (dateDiff !== 0) return dateDiff;
      return a.position - b.position;
    });
  }

  if (!unique.length) throw new Error(`Nu am găsit ancore/articole valide de update pentru ${game.name}.`);

  const articleUrl = unique[0].href;
  const articleRes = await httpReq('GET', articleUrl);
  const $art = cheerio.load(String(articleRes.data || ""));
  
  const ogTitle = $art('meta[property="og:title"]').attr('content') || $art('meta[name="twitter:title"]').attr('content') || $art('title').text() || "";
  const ogDesc = $art('meta[property="og:description"]').attr('content') || $art('meta[name="twitter:description"]').attr('content') || $art('meta[name="description"]').attr('content') || "";
  const ogImg = $art('meta[property="og:image"]').attr('content') || $art('meta[name="twitter:image"]').attr('content') || undefined;
  const pubTime = $art('meta[property="article:published_time"]').attr('content') || $art('meta[property="og:updated_time"]').attr('content') || "";

  $art('script, style').remove();
  const cleanHtml = $art('body').text();

  return normalizeUpdate({
    id: String(articleUrl),
    title: cleanText(ogTitle) || `Update nou pentru ${game.name}`,
    link: articleUrl,
    excerpt: cleanText(ogDesc),
    fullText: cleanText(cleanHtml),
    image: ogImg,
    thumbnail: game.thumbnail || undefined,
    timestamp: pubTime
  });
}

async function fetchMinecraftUpdate() {
  const res = await httpReq('GET', "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const latestVersion = res?.data?.latest?.release;
  if (!latestVersion) throw new Error("Date lipsă pe serverul Mojang.");

  const formattedVersion = latestVersion.replace(/\./g, "-");
  const excerpt = `O nouă versiune oficială (${latestVersion}) este disponibilă!`;

  return normalizeUpdate({
    id: String(latestVersion),
    title: `Minecraft: Java Edition ${latestVersion}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${formattedVersion}`,
    excerpt: excerpt,
    fullText: excerpt,
    image: "https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/MCV-keyart-default.jpg",
    thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg",
    timestamp: ""
  });
}

async function fetchFortniteUpdate() {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent("https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US")}`;
    const res = await httpReq('GET', proxyUrl, { timeout: 20000 });
    const posts = JSON.parse(res?.data?.contents || "{}")?.blogList;

    if (!Array.isArray(posts) || posts.length === 0) throw new Error();

    const validPosts = posts.filter(p => p.slug && p.slug.trim() !== "" && p.slug.toLowerCase() !== "news");
    if (validPosts.length === 0) throw new Error();

    let latest = validPosts.find(p => {
      const t = String(p.title).toLowerCase();
      return t.includes("update") || t.includes("patch") || /\bv\d+(\.\d+)*\b/i.test(t) || String(p.category || "").toLowerCase() === "patch notes";
    });

    if (!latest) latest = validPosts[0];

    return normalizeUpdate({
      id: String(latest._id || latest.slug),
      title: cleanText(latest.title) || "Fortnite Update",
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: cleanText(latest.shareDescription || "A apărut o nouă actualizare oficială."),
      fullText: cleanText(latest.content || latest.shareDescription),
      image: latest.image || latest.trendingImage,
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date ? new Date(latest.date).toISOString() : ""
    });
  } catch (error) {
    console.warn("[Fortnite Fetch] API-ul Epic a eșuat. Execut fallback-ul pe RSS...");
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const fallbackRes = await httpReq('GET', backupUrl);
    const feed = await rssParser.parseString(fallbackRes.data);

    if (!feed.items || feed.items.length === 0) throw new Error("Toate metodele pentru Fortnite au eșuat.");
    
    const latestBackup = feed.items[0];
    const excerpt = "A apărut un nou articol oficial de actualizare pe site-ul Fortnite.";

    return normalizeUpdate({
      id: String(latestBackup.guid || latestBackup.link),
      title: cleanText(latestBackup.title).replace(/\s-\sFortnite$/i, "").trim() || "Fortnite: Noutăți",
      link: latestBackup.link || "https://www.fortnite.com/news",
      excerpt: excerpt,
      fullText: excerpt,
      image: "https://cdn2.unrealengine.com/14br-consoles-1920x1080-1920x1080-4954ecbc82b3.jpg",
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latestBackup.pubDate ? new Date(latestBackup.pubDate).toISOString() : ""
    });
  }
}

async function fetchRobloxUpdate() {
  const res = await httpReq('GET', "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer");
  const version = res?.data?.clientVersionUpload;
  if (!version) throw new Error("Nu am putut accesa serverul de update Roblox.");

  const excerpt = `Un nou client oficial Roblox a fost urcat pe servere (versiunea: ${version}).`;

  return normalizeUpdate({
    id: String(version),
    title: "Roblox Client Update",
    link: "https://en.help.roblox.com/hc/en-us/articles/203312870-Update-Log",
    excerpt: excerpt,
    fullText: excerpt,
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg",
    timestamp: ""
  });
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL ȘI STRUCTURA DE EVENIMENTE
// -------------------------------------------------------------
async function fetchGameUpdate(game) {
  const type = game.type;
  const key = game.key;

  if (!type || type === "steam") return await fetchSteamUpdate(game);
  if (type === "minecraft") return await fetchMinecraftUpdate();
  if (type === "epic_games" && key === "fortnite") return await fetchFortniteUpdate();
  if (type === "roblox") return await fetchRobloxUpdate();
  if (type === "nvidia") return await fetchNvidiaUpdate(game);
  if (type === "intel") return await fetchIntelUpdate(game);
  if (type === "amd") return await fetchAmdUpdate(game);
  if (type === "listing_based" || (type === "epic_games" && key !== "fortnite")) return await fetchListingBasedUpdate(game);

  throw new Error(`Tip de joc necunoscut pentru ${game.name}.`);
}

async function getLatestForAllGames() {
  const results = [];
  const chunkSize = 3;

  for (let i = 0; i < config.games.length; i += chunkSize) {
    const chunk = config.games.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(async (game) => {
      try {
        const latest = await fetchGameUpdate(game);
        return { game, latest, error: null };
      } catch (error) {
        return { game, latest: null, error: error.message };
      }
    }));
    results.push(...chunkResults);
  }
  return results;
}

async function checkForUpdates() {
  const guilds = await GuildModel.find({ subscribed: true }).lean();
  if (guilds.length === 0) return;
  const results = await getLatestForAllGames();

  for (const guildConfig of guilds) {
    if (!guildConfig.notificationChannelId) continue;
    if (!guildConfig.seen) guildConfig.seen = {};
    let channel = null;

    try { channel = await client.channels.fetch(guildConfig.notificationChannelId); } 
    catch (err) {
      if (err.code === 10003 || err.code === 50001) await GuildModel.updateOne({ _id: guildConfig._id }, { $set: { subscribed: false, notificationChannelId: null, seen: {} } });
      continue;
    }
    if (!channel) continue;

    for (const { game, latest, error } of results) {
      if (error || !latest) continue;

      if (guildConfig.seen[game.key] !== latest.id) {
        const updateResult = await GuildModel.updateOne(
          { _id: guildConfig._id, [`seen.${game.key}`]: { $ne: latest.id } },
          { $set: { [`seen.${game.key}`]: latest.id } }
        );

        if (updateResult.modifiedCount > 0) {
          try {
            await channel.send({ embeds: [buildUpdateEmbed(game.name, latest)] });
            guildConfig.seen[game.key] = latest.id;
          } catch (err) {
            const previousId = guildConfig.seen[game.key];
            if (previousId) await GuildModel.updateOne({ _id: guildConfig._id, [`seen.${game.key}`]: latest.id }, { $set: { [`seen.${game.key}`]: previousId } });
            else await GuildModel.updateOne({ _id: guildConfig._id, [`seen.${game.key}`]: latest.id }, { $unset: { [`seen.${game.key}`]: "" } });
          }
        }
      }
    }
  }
}

// -------------------------------------------------------------
// REDUCERI 
// -------------------------------------------------------------
async function fetchDealsForStore(storeID, storeName) {
  const targetUrl = `https://www.cheapshark.com/api/1.0/deals?storeID=${storeID}&onSale=1&pageSize=50`;
  let deals = null;
  try {
    const res = await httpReq('GET', targetUrl, { headers: { "Accept": "application/json" } });
    if (Array.isArray(res.data)) deals = res.data;
  } catch (err) { console.warn("[Deals Fetch] failed:", err.message); }

  if (!Array.isArray(deals) || deals.length === 0) return [];

  const validDeals = deals.filter(d => {
    const savings = parseFloat(d.savings) || 0;
    const salePrice = parseFloat(d.salePrice) || 0;
    const isFree = salePrice === 0;
    const steamRating = parseFloat(d.steamRatingPercent) || 0;
    const metacritic = parseInt(d.metacriticScore) || 0;
    if (storeID === EPIC_STORE_ID) return (savings >= 70 || isFree);
    return (savings >= 70 || isFree) && (steamRating >= 70 || metacritic > 0 || isFree);
  });

  return validDeals.map(d => ({
    id: d.dealID,
    steamAppID: d.steamAppID,
    title: d.title || "Joc Necunoscut",
    salePrice: d.salePrice || "0.00",
    normalPrice: d.normalPrice || "0.00",
    savings: Math.round(parseFloat(d.savings) || 0),
    store: storeName,
    link: storeID === STEAM_STORE_ID ? `https://store.steampowered.com/app/${d.steamAppID}` : `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
    thumbnail: d.thumb || null,
    popularityScore: (parseInt(d.steamRatingCount) || 0) + ((parseInt(d.metacriticScore) || 0) * 100),
    endDateStr: "Nespecificat",
    extraDetails: "",
    enriched: false
  }));
}

async function fetchDeals() {
  const steamDeals = await fetchDealsForStore(STEAM_STORE_ID, "Steam");
  const epicDeals = await fetchDealsForStore(EPIC_STORE_ID, "Epic Games");
  const finalTop50 = [...steamDeals, ...epicDeals].sort((a, b) => b.popularityScore - a.popularityScore).slice(0, 50);
  if (finalTop50.length === 0) throw new Error("Nu s-au putut extrage oferte valide de pe Steam sau Epic.");
  return finalTop50;
}

async function enrichDealData(deal) {
  if (deal.enriched) return deal;
  if (deal.store === "Steam" && deal.steamAppID) {
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}`;
      const res = await httpReq('GET', url, { timeout: 5000 });
      const data = res.data[deal.steamAppID]?.data;
      if (data) {
        if (data.release_date && data.release_date.date) deal.extraDetails += `\n**Lansare:** ${data.release_date.date}`;
        if (data.platforms) {
          const plats = [];
          if (data.platforms.windows) plats.push("Windows");
          if (data.platforms.mac) plats.push("Mac");
          if (data.platforms.linux) plats.push("Linux");
          if (plats.length > 0) deal.extraDetails += `\n**Platforme:** ${plats.join(", ")}`;
        }
      }
      const htmlRes = await httpReq('GET', deal.link, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
      const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
      if (match && match[1]) deal.endDateStr = match[1].trim();
    } catch (e) { console.warn(`[Enrich] Steam failed pt id ${deal.steamAppID}:`, e.message); }
  }
  deal.enriched = true;
  return deal;
}

async function checkForDiscounts() {
  const guilds = await GuildModel.find({ discountsSubscribed: true }).lean();
  if (guilds.length === 0) return;
  try {
    const deals = await fetchDeals();
    for (const guildConfig of guilds) {
      if (!guildConfig.discountChannelId) continue;
      if (!guildConfig.seenDiscounts) guildConfig.seenDiscounts = [];
      let channel = null;
      try { channel = await client.channels.fetch(guildConfig.discountChannelId); } 
      catch (err) {
        if (err.code === 10003 || err.code === 50001) await GuildModel.updateOne({ _id: guildConfig._id }, { $set: { discountsSubscribed: false, discountChannelId: null, seenDiscounts: [] } });
        continue;
      }
      if (!channel) continue;

      for (const deal of deals) {
        if (!guildConfig.seenDiscounts.includes(deal.id)) {
          const updateResult = await GuildModel.updateOne(
            { _id: guildConfig._id, seenDiscounts: { $ne: deal.id } },
            { $push: { seenDiscounts: { $each: [deal.id], $slice: -300 } } }
          );

          if (updateResult.modifiedCount > 0) {
            if (!deal.enriched) await enrichDealData(deal);
            const isFree = parseFloat(deal.salePrice) === 0;
            const embed = new EmbedBuilder()
              .setColor(isFree ? 0xffd700 : 0xe74c3c)
              .setTitle(String(`${isFree ? "Joc Gratuit: " : "Reducere: "}${deal.title}`).slice(0, 250))
              .setDescription(`**${deal.store}** oferă o reducere masivă de **${deal.savings}%**!\n\n` + (deal.endDateStr !== "Nespecificat" ? `⏳ **${isFree ? "Gratis până la" : "Oferta expiră la"}:** ${deal.endDateStr}\n\n` : ""))
              .addFields(
                { name: "Preț Vechi", value: `~~$${deal.normalPrice}~~`, inline: true },
                { name: "Preț Nou", value: isFree ? "🔥 GRATUIT 🔥" : `$${deal.salePrice}`, inline: true },
                { name: "Link Către Magazin", value: `[Apasă aici pentru ofertă](${deal.link})`, inline: false }
              )
              .setTimestamp();

            if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
            if (deal.extraDetails) embed.addFields({ name: "Detalii Suplimentare", value: deal.extraDetails.trim().substring(0, 1020), inline: false });

            try {
              await channel.send({ embeds: [embed] });
              guildConfig.seenDiscounts.push(deal.id);
            } catch (e) {
              await GuildModel.updateOne({ _id: guildConfig._id }, { $pull: { seenDiscounts: deal.id } });
            }
          }
        }
      }
    }
  } catch (err) { console.error("Eroare la căutarea reducerilor:", err.message); }
}


// -------------------------------------------------------------
// COMMAND ROUTER & HANDLERS 
// -------------------------------------------------------------
async function handlePing(message) {
  await message.reply("Pong! 🏓 Sistemele sunt operaționale.");
}

async function handleGames(message) {
  await message.reply(`🎮 Jocuri urmărite:\n${config.games.map((g) => `- ${g.name}`).join("\n")}`);
}

async function handlePorecle(message) {
  const list = config.games.map((g) => `${g.name} -> folosește porecla: ${g.key}`).join("\n");
  await message.reply(`🏷️ Lista de porecle pentru jocuri:\nPentru a vedea ultimul update al unui joc specific, folosește comanda \`${PREFIX}latest update [poreclă]\`.\n\n${list}`);
}

async function handleStart(message, args, command2, guildId) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un administrator poate folosi comanda.");

  if (command2 === "updates") {
    const msg = await message.reply("⏳ Setez canalul și preiau istoricul jocurilor (ca să nu te spamez cu alerte vechi)...");
    const results = await getLatestForAllGames();
    let seenData = {};
    for (const r of results) { if (r.latest) seenData[`seen.${r.game.key}`] = r.latest.id; }

    await GuildModel.updateOne(
      { _id: guildId }, 
      { $set: { subscribed: true, notificationChannelId: message.channel.id, ...seenData }, $setOnInsert: { discountsSubscribed: false, discountChannelId: null, seenDiscounts: [] } }, 
      { upsert: true }
    );
    return msg.edit("✅ Am pornit notificările automate de update-uri pe acest canal pentru acest server.");
  }

  if (command2 === "reduceri") {
    const loadingMsg = await message.reply("⏳ Preiau istoricul ofertelor curente pentru a preveni spam-ul...");
    let initialDealsIds = [];
    try {
      const currentDeals = await fetchDeals();
      initialDealsIds = currentDeals.map(d => d.id).slice(-300);
    } catch (e) { console.warn("Nu s-au putut prelua ofertele la comanda start reduceri:", e.message); }

    await GuildModel.updateOne(
      { _id: guildId }, 
      { $set: { discountsSubscribed: true, discountChannelId: message.channel.id, seenDiscounts: initialDealsIds }, $setOnInsert: { subscribed: false, notificationChannelId: null, seen: {} } }, 
      { upsert: true }
    );
    await loadingMsg.edit("✅ Am activat alertele pentru reduceri masive pe acest canal! Vei primi **doar** oferte noi apărute de acum înainte.");
  }
}

async function handleStop(message, args, command2, guildId) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un administrator poate folosi comanda.");

  if (command2 === "updates") {
    await GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false, notificationChannelId: null, seen: {} } });
    return message.reply("🛑 Am oprit notificările automate de update pentru acest server.");
  }

  if (command2 === "reduceri") {
    await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false, discountChannelId: null, seenDiscounts: [] } });
    return message.reply("🛑 Am oprit notificările pentru reduceri pe acest server.");
  }
}

async function handleLatest(message, args, command2) {
  // === LATEST REDUCERI ===
  if (command2 === "reduceri") {
    let rawDeals;
    let isCached = false;

    if (Date.now() < cache.deals.expiresAt && cache.deals.data) {
      rawDeals = cache.deals.data;
      isCached = true;
    }

    let loadingMsg;
    let executionTimes;
    let startTime = Date.now();
    let estMs = 15000;

    if (isCached) loadingMsg = await message.reply(`⏳ *Aduc datele instantaneu din cache...*`);
    else {
      executionTimes = await getSystemTimes();
      estMs = executionTimes.reduceri || 15000;
      loadingMsg = await message.reply(`⏳ *Caut oferte pe servere... Durată estimată: ${Math.max(1, Math.ceil(estMs / 1000))} secunde.*`);
    }

    try {
      if (!isCached) {
        rawDeals = await fetchDeals();
        cache.deals = { data: rawDeals, expiresAt: Date.now() + 180000 };
        const elapsed = Date.now() - startTime;
        executionTimes.reduceri = Math.round((estMs + elapsed) / 2);
        await saveSystemTimes(executionTimes);
      }

      if (!rawDeals || rawDeals.length === 0) return loadingMsg.edit("❌ Nu am găsit nicio ofertă activă.");

      const maxDeals = rawDeals.slice(0, 50);
      let currentPage = 0;
      const itemsPerPage = 5;
      const totalPages = Math.ceil(maxDeals.length / itemsPerPage);

      const generatePageEmbeds = async (pageIndex) => {
        const startIndex = pageIndex * itemsPerPage;
        const chunk = maxDeals.slice(startIndex, startIndex + itemsPerPage);
        const enrichedChunk = await Promise.all(chunk.map(d => enrichDealData(d)));

        return enrichedChunk.map(deal => {
          const isFree = parseFloat(deal.salePrice) === 0;
          const embed = new EmbedBuilder()
            .setColor(isFree ? 0x0099ff : 0x2b2d31)
            .setTitle(`${isFree ? "Joc Gratuit: " : "Reducere: "}${String(deal.title).slice(0, 200)}`)
            .setAuthor({ name: deal.store })
            .setDescription(`**Preț:**\n~~$${deal.normalPrice}~~ ${isFree ? "GRATUIT" : `$${deal.salePrice} (-${deal.savings}%)`}\n\n` + (deal.endDateStr !== "Nespecificat" ? `**${isFree ? "Gratis până la" : "Oferta expiră la"}:**\n${deal.endDateStr}\n\n` : "") + `🔗 [Accesează Magazinul](${deal.link})`)
            .setFooter({ text: `Pagina ${pageIndex + 1} din ${totalPages}` });

          if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
          if (deal.extraDetails) embed.addFields({ name: "Detalii Suplimentare", value: deal.extraDetails.trim().substring(0, 1020), inline: false });
          return embed;
        });
      };

      const generateButtons = (pageIndex) => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("prev_page").setLabel("◀ Pagina Anterioară").setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
          new ButtonBuilder().setCustomId("next_page").setLabel("Următoarea Pagină ▶").setStyle(ButtonStyle.Primary).setDisabled(pageIndex === totalPages - 1)
        );
      };

      const firstPageEmbeds = await generatePageEmbeds(currentPage);
      const replyMsg = await loadingMsg.edit({ content: `✅ **Top ${maxDeals.length} oferte Steam & Epic găsite:**`, embeds: firstPageEmbeds, components: [generateButtons(currentPage)] });

      const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
      collector.on("collect", async (btnInteraction) => {
        if (btnInteraction.user.id !== message.author.id) return btnInteraction.reply({ content: "Doar cel care a cerut comanda poate schimba paginile!", ephemeral: true });
        if (btnInteraction.customId === "prev_page") currentPage--;
        if (btnInteraction.customId === "next_page") currentPage++;
        await btnInteraction.deferUpdate();
        const newEmbeds = await generatePageEmbeds(currentPage);
        await btnInteraction.editReply({ embeds: newEmbeds, components: [generateButtons(currentPage)] });
      });
      collector.on("end", () => replyMsg.edit({ components: [] }).catch(() => null));
    } catch (error) { await loadingMsg.edit(`❌ Eroare la extragerea datelor: \`${error.message}\``).catch(() => null); }
    return;
  }

  // === LATEST UPDATES (ALL) ===
  if (command2 === "updates") {
    let results;
    let isCached = false;

    if (Date.now() < cache.updates.expiresAt && cache.updates.data) {
      results = cache.updates.data;
      isCached = true;
    }

    let loadingMsg;
    let executionTimes;
    let startTime = Date.now();
    let estMs = 15000;

    if (isCached) loadingMsg = await message.reply(`⏳ *Aduc datele instantaneu din cache...*`);
    else {
      executionTimes = await getSystemTimes();
      estMs = executionTimes.all || 15000;
      loadingMsg = await message.reply(`⏳ *Mă conectez la servere... Durată estimată: ${Math.max(1, Math.ceil(estMs / 1000))} secunde.*`);

      results = await getLatestForAllGames();
      cache.updates = { data: results, expiresAt: Date.now() + 180000 };

      const elapsed = Date.now() - startTime;
      executionTimes.all = Math.round((estMs + elapsed) / 2);
      await saveSystemTimes(executionTimes);
    }

    const validResults = results.filter(r => r.latest !== null);
    if (validResults.length === 0) return loadingMsg.edit("❌ Nu am putut prelua update-uri pentru niciun joc.");

    let currentPage = 0;
    const itemsPerPage = 5;
    const totalPages = Math.ceil(validResults.length / itemsPerPage);

    const getPageEmbeds = async (pageIndex) => {
      const startIndex = pageIndex * itemsPerPage;
      const chunk = validResults.slice(startIndex, startIndex + itemsPerPage);
      return chunk.map(r => {
        const emb = buildUpdateEmbed(r.game.name, r.latest);
        emb.setFooter({ text: `${r.game.name} • Pagina ${pageIndex + 1} din ${totalPages}` });
        return emb;
      });
    };

    const generateUpdateButtons = (pageIndex) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev_upd").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
        new ButtonBuilder().setCustomId("next_upd").setLabel("▶").setStyle(ButtonStyle.Primary).setDisabled(pageIndex === totalPages - 1)
      );
    };

    let currentEmbeds = await getPageEmbeds(currentPage);
    const replyMsg = await loadingMsg.edit({ content: `✅ **Cele mai recente update-uri (${validResults.length} rezultate disponibile):**`, embeds: currentEmbeds, components: [generateUpdateButtons(currentPage)] });

    const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
    collector.on("collect", async (btnInteraction) => {
      if (btnInteraction.user.id !== message.author.id) return btnInteraction.reply({ content: "Doar utilizatorul care a apelat comanda poate folosi butoanele!", ephemeral: true });
      await btnInteraction.deferUpdate();
      if (btnInteraction.customId === "prev_upd") currentPage--;
      else if (btnInteraction.customId === "next_upd") currentPage++;
      currentEmbeds = await getPageEmbeds(currentPage);
      await btnInteraction.editReply({ embeds: currentEmbeds, components: [generateUpdateButtons(currentPage)] });
    });
    collector.on("end", () => replyMsg.edit({ components: [] }).catch(() => null));
    return;
  }

  // === LATEST UPDATE [JOC] ===
  if (command2 === "update") {
    args.shift();
    const gameText = args.join(" ");
    const executionTimes = await getSystemTimes();
    const estMs = executionTimes.single || 2000;
    const estSec = Math.max(1, Math.ceil(estMs / 1000));

    const loadingMsg = await message.reply(`⏳ *Mă conectez la servere... Durată estimată: **${estSec} secunde**.*`);
    const startTime = Date.now();

    const game = findGameFromText(gameText);
    if (!game) return loadingMsg.edit(`❌ Nu am găsit jocul. Folosește **${PREFIX}porecle** pentru a vedea lista exactă.`);

    try {
      let latest;
      const cachedItem = cache.single.get(game.key);
      
      if (cachedItem && Date.now() < cachedItem.expiresAt) {
        latest = cachedItem.data;
      } else {
        latest = await fetchGameUpdate(game);
        cache.single.set(game.key, { data: latest, expiresAt: Date.now() + 180000 });

        const elapsed = Date.now() - startTime;
        executionTimes.single = Math.round((estMs + elapsed) / 2);
        await saveSystemTimes(executionTimes);
      }
      await loadingMsg.edit({ content: `✅ Cel mai recent update pentru **${game.name}**:`, embeds: [buildUpdateEmbed(game.name, latest)] }).catch(() => null);
    } catch (error) {
      console.warn(`[Latest Single] Eroare la ${game.name}:`, error.message);
      await loadingMsg.edit(`❌ Nu am putut lua ultimul update pentru **${game.name}**.`);
    }
    return;
  }

  await message.reply(`❌ Comandă incorectă. Folosește \`${PREFIX}help\` pentru a vedea cum se folosesc comenzile noi.`);
}

async function handleHelp(message) {
  const helpEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle("📚 Manualul Botului - Meniul de Ajutor")
    .setDescription("Iată lista completă a comenzilor și explicația exactă a ceea ce face fiecare:")
    .addFields(
      { name: `${PREFIX}start updates`, value: "Setează canalul unde botul va trimite automat mesaje de fiecare dată când apare un update oficial nou." },
      { name: `${PREFIX}stop updates`, value: "Oprește notificările automate de update-uri pentru tot serverul și curăță datele salvate." },
      { name: `${PREFIX}start reduceri`, value: "Setează canalul pentru alertele cu reduceri masive de preț (peste 70%) sau jocuri complet gratuite." },
      { name: `${PREFIX}stop reduceri`, value: "Oprește alertele automate de oferte și curăță configurația canalului curent." },
      { name: `${PREFIX}latest updates`, value: "Afișează pe loc, manual, o listă structurată cu cele mai noi update-uri pentru toate jocurile monitorizate." },
      { name: `${PREFIX}latest update [poreclă]`, value: `Caută imediat cel mai recent update pentru un anumit joc. De exemplu, scrii \`${PREFIX}latest update cs2\` și primești ultimul update la Counter-Strike 2.` },
      { name: `${PREFIX}latest reduceri`, value: "Caută manual și afișează topul ofertelor și jocurilor gratuite valabile în acest moment pe Steam și Epic Games." },
      { name: `${PREFIX}games`, value: "Îți arată o listă curată cu numele tuturor jocurilor și driverelor incluse momentan în baza mea de date." },
      { name: `${PREFIX}porecle`, value: `Îți arată cuvintele cheie (poreclele) pe care trebuie să le folosești alături de comanda \`latest update\` pentru a găsi rapid jocul dorit.` },
      { name: `${PREFIX}ping`, value: "Testează rapid dacă sunt online și îți arată că sistemele mele sunt operaționale." }
    )
    .setFooter({ text: "Pentru orice eroare, contactează administratorul." })
    .setTimestamp();

  await message.reply({ embeds: [helpEmbed] });
}

// -------------------------------------------------------------
// EVENT HANDLERS & CRON
// -------------------------------------------------------------
client.once("ready", () => {
  console.log(`🤖 Botul este online și așteaptă comenzi: ${client.user.tag}`);

  const runChecks = async () => {
    cleanCache();
    if (isChecking) {
      console.log("⏳ Locking activ: Se sare peste verificare, runda precedentă încă rulează...");
      return;
    }
    isChecking = true;
    try {
      await checkForUpdates();
      await checkForDiscounts();
    } catch (err) { console.error("❌ Eroare în Loop-ul principal:", err); } 
    finally { isChecking = false; }
  };

  runChecks();
  const intervalMinutes = Number(config.checkIntervalMinutes || 30);
  cron.schedule(`*/${intervalMinutes} * * * *`, runChecks);
  console.log(`⏱️ Schedular activat. Verificările se fac automat la fiecare ${intervalMinutes} minute.`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command1 = (args.shift() || "").toLowerCase();
  const command2 = (args[0] || "").toLowerCase();
  const guildId = message.guild.id;

  const commands = {
    ping: handlePing,
    games: handleGames,
    porecle: handlePorecle,
    start: handleStart,
    stop: handleStop,
    latest: handleLatest,
    help: handleHelp
  };

  if (commands[command1]) {
    await commands[command1](message, args, command2, guildId);
  }
});

// -------------------------------------------------------------
// BOOTSTRAP - PORNIRE SECURIZATĂ
// -------------------------------------------------------------
async function bootstrap() {
  if (!process.env.MONGO_URI) { console.error("❌ CRITIC: Lipsește variabila de mediu MONGO_URI!"); process.exit(1); }
  if (!process.env.DISCORD_TOKEN) { console.error("❌ CRITIC: Lipsește variabila de mediu DISCORD_TOKEN!"); process.exit(1); }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Conectat cu succes la baza de date MongoDB!");
    await client.login(process.env.DISCORD_TOKEN);
    console.log("✅ Botul s-a logat cu succes pe Discord.");
  } catch (err) {
    console.error("❌ Eroare la bootstrap (conexiune picată):", err);
    process.exit(1);
  }
}

bootstrap();

