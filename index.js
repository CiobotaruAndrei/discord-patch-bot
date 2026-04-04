const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const crypto = require("crypto");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder
} = require("discord.js");

const CONFIG_PATH = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

// -------------------------------------------------------------
// VALIDĂRI DE BAZĂ
// -------------------------------------------------------------

if (!process.env.MONGO_URI) {
  console.error("❌ CRITIC: Lipsește variabila de mediu MONGO_URI!");
  process.exit(1);
}

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ CRITIC: Lipsește variabila de mediu DISCORD_TOKEN!");
  process.exit(1);
}

if (!config || typeof config !== "object" || !Array.isArray(config.games)) {
  console.error("❌ CRITIC: config.json este invalid.");
  process.exit(1);
}

// -------------------------------------------------------------
// CONEXIUNE ȘI SCHEMA MONGODB PENTRU STARE PERSISTENTĂ
// seen și seenDiscounts sunt acum per guild
// -------------------------------------------------------------

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectat cu succes la baza de date MongoDB!"))
  .catch((err) => {
    console.error("❌ Eroare critică la conectarea MongoDB:", err);
    process.exit(1);
  });

const stateSchema = new mongoose.Schema({
  _id: { type: String, default: "global_state" },
  guilds: { type: Object, default: {} },
  executionTimes: {
    type: Object,
    default: { all: 15000, single: 2000, reduceri: 15000 }
  }
}, { minimize: false });

const StateModel = mongoose.model("State", stateSchema);

function normalizeGuildState(guildState = {}) {
  return {
    subscribed: Boolean(guildState.subscribed),
    notificationChannelId: guildState.notificationChannelId || "",
    discountsSubscribed: Boolean(guildState.discountsSubscribed),
    discountChannelId: guildState.discountChannelId || "",
    seen: typeof guildState.seen === "object" && guildState.seen ? guildState.seen : {},
    seenDiscounts: Array.isArray(guildState.seenDiscounts) ? guildState.seenDiscounts : []
  };
}

async function loadState() {
  let state = await StateModel.findById("global_state").lean();

  if (!state) {
    state = {
      _id: "global_state",
      guilds: {},
      executionTimes: { all: 15000, single: 2000, reduceri: 15000 }
    };
    await StateModel.create(state);
  }

  if (!state.guilds || typeof state.guilds !== "object") state.guilds = {};
  if (!state.executionTimes || typeof state.executionTimes !== "object") {
    state.executionTimes = { all: 15000, single: 2000, reduceri: 15000 };
  }

  for (const guildId of Object.keys(state.guilds)) {
    state.guilds[guildId] = normalizeGuildState(state.guilds[guildId]);
  }

  return state;
}

async function saveState(stateObj) {
  await StateModel.findByIdAndUpdate(
    "global_state",
    { $set: stateObj },
    { upsert: true, runValidators: true }
  );
}

function ensureGuildState(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = normalizeGuildState();
  } else {
    state.guilds[guildId] = normalizeGuildState(state.guilds[guildId]);
  }

  return state.guilds[guildId];
}

// -------------------------------------------------------------
// CACHE SCURT PENTRU COMENZI MANUALE
// -------------------------------------------------------------

class TTLCache {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const item = this.map.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.map.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, ttlMs) {
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    return value;
  }

  async getOrSet(key, ttlMs, producer) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const value = await producer();
    this.set(key, value, ttlMs);
    return value;
  }

  clear() {
    this.map.clear();
  }
}

const manualCache = new TTLCache();

// -------------------------------------------------------------
// REQUEST HELPER COMUN CU RETRY + TIMEOUT
// -------------------------------------------------------------

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 3;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpRequest({
  method = "GET",
  url,
  data,
  timeout = DEFAULT_TIMEOUT,
  retries = DEFAULT_RETRIES,
  headers = {},
  validateStatus
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios({
        method,
        url,
        data,
        timeout,
        validateStatus,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "*/*",
          ...headers
        }
      });
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const retryable = !status || status === 408 || status === 425 || status === 429 || status >= 500;

      if (attempt >= retries || !retryable) {
        throw lastError;
      }

      await sleep(400 * attempt);
    }
  }

  throw lastError;
}

async function httpGet(url, options = {}) {
  return httpRequest({ method: "GET", url, ...options });
}

async function httpPost(url, data, options = {}) {
  return httpRequest({ method: "POST", url, data, ...options });
}

// -------------------------------------------------------------
// FUNCȚII UTILITARE DE BAZĂ
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

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function absoluteUrl(base, maybeRelative) {
  if (!maybeRelative) return "";
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return `${base.replace(/\/$/, "")}/${String(maybeRelative).replace(/^\//, "")}`;
}

function extractMetaContent(html, key, attr = "property") {
  const regex = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const match = html.match(regex);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractTitleFromHtml(html) {
  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle) return cleanText(ogTitle);

  const twitterTitle = extractMetaContent(html, "twitter:title", "name");
  if (twitterTitle) return cleanText(twitterTitle);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return cleanText(decodeHtmlEntities(titleMatch[1]));

  return "";
}

function extractDescriptionFromHtml(html) {
  const ogDescription = extractMetaContent(html, "og:description");
  if (ogDescription) return cleanText(ogDescription);

  const twitterDescription = extractMetaContent(html, "twitter:description", "name");
  if (twitterDescription) return cleanText(twitterDescription);

  const metaDescription = extractMetaContent(html, "description", "name");
  if (metaDescription) return cleanText(metaDescription);

  return "";
}

function extractImageFromHtml(html) {
  return (
    extractMetaContent(html, "og:image") ||
    extractMetaContent(html, "twitter:image", "name") ||
    undefined
  );
}

function extractPublishedTimeFromHtml(html) {
  return (
    extractMetaContent(html, "article:published_time") ||
    extractMetaContent(html, "og:updated_time") ||
    new Date().toISOString()
  );
}

function isGoodSteamArticleUrl(url) {
  const val = String(url || "").trim().toLowerCase();
  if (!val) return false;
  if (!val.startsWith("http")) return false;
  if (val.includes("steamstatic")) return false;
  if (val.includes("steamcdn")) return false;
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

function parseAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    anchors.push({
      href: absoluteUrl(baseUrl, match[1]),
      text: cleanText(match[2])
    });
  }
  return anchors;
}

function uniqueByHref(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item.href || seen.has(item.href)) continue;
    seen.add(item.href);
    result.push(item);
  }
  return result;
}

function scoreCandidate(candidate, keywords) {
  const haystack = `${candidate.href} ${candidate.text}`.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(String(keyword).toLowerCase())) score += 1;
  }
  return score;
}

function buildStableHash(obj) {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex");
}

// -------------------------------------------------------------
// EMBEDS
// -------------------------------------------------------------

function buildUpdateEmbed(gameName, latest) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(latest.title || `Update nou pentru ${gameName}`)
    .setDescription((latest.excerpt || `A apărut un nou update pentru ${gameName}.`).slice(0, 4000))
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

function buildDealEmbed(deal) {
  const isFree = parseFloat(deal.salePrice) === 0;

  const embed = new EmbedBuilder()
    .setColor(isFree ? 0xffd700 : 0xe74c3c)
    .setTitle(String(`${isFree ? "Free Game: " : "Reducere: "}${deal.title}`).slice(0, 250))
    .setDescription(
      `**${deal.store}** oferă o reducere masivă de **${deal.savings}%**!\n\n` +
      (deal.endDateStr !== "Nespecificat" ? `⏳ **${isFree ? "Free until" : "Offer ends"}:** ${deal.endDateStr}\n\n` : "")
    )
    .addFields(
      { name: "Preț Vechi", value: `~~$${deal.normalPrice}~~`, inline: true },
      { name: "Preț Nou", value: isFree ? "🔥 GRATIS 🔥" : `$${deal.salePrice}`, inline: true },
      { name: "Link Către Magazin", value: `[Apasă aici pentru ofertă](${deal.link})`, inline: false }
    )
    .setTimestamp();

  if (deal.thumbnail && deal.thumbnail.startsWith("http")) {
    embed.setThumbnail(deal.thumbnail);
  }

  return embed;
}

// -------------------------------------------------------------
// FUNCȚII PENTRU DRIVERE
// -------------------------------------------------------------

async function fetchNvidiaUpdate(game) {
  const exactQuery = game.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const searchQuery = `site:nvidia.com ${exactQuery} release`;

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpGet(rssUrl);
  const xml = String(res.data || "");

  const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/i);

  if (itemMatch) {
    const itemXml = itemMatch[1];
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const rawTitle = titleMatch ? cleanText(titleMatch[1]) : `Update ${game.name}`;
    const cleanT = rawTitle.split(" - ")[0];
    const link = linkMatch ? linkMatch[1] : "https://www.nvidia.com/en-us/geforce/news/";
    const pubDate = dateMatch ? dateMatch[1] : new Date().toISOString();

    const vMatch = cleanT.match(/\b(\d{3}\.\d{2})\b/);
    const versionStr = vMatch ? `v${vMatch[1]}` : "Update Nou";

    return {
      id: cleanT,
      hash: buildStableHash({ cleanT, link, pubDate }),
      title: `${game.name} ${versionStr}`,
      link: link,
      excerpt: `Sursa: Sistemul oficial de articole NVIDIA.`,
      fullText: `Sursa: Sistemul oficial de articole NVIDIA. Noul driver ${versionStr} este disponibil.`,
      thumbnail: game.thumbnail,
      timestamp: new Date(pubDate).toISOString()
    };
  }

  throw new Error(`Nu am putut găsi date pentru ${game.name}.`);
}

async function fetchIntelUpdate(game) {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(game.url)}`;
    const res = await httpGet(proxyUrl);
    const html = String(res?.data?.contents || "");
    const versionMatch = html.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);

    if (versionMatch) {
      const version = versionMatch[1];
      return {
        id: version,
        hash: buildStableHash({ version, link: game.url }),
        title: `${game.name} v${version}`,
        link: game.url,
        excerpt: `Extras direct de pe pagina oficială Intel.\n**Versiune găsită:** ${version}`,
        fullText: `Extras direct de pe pagina oficială Intel. Versiune nouă detectată: ${version}`,
        thumbnail: game.thumbnail,
        timestamp: new Date().toISOString()
      };
    }
  } catch (err) {}

  const searchQuery = game.key === "intelpro"
    ? 'site:intel.com "Intel Arc Pro Graphics"'
    : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const fallbackRes = await httpGet(rssUrl);
  const xml = String(fallbackRes.data || "");
  const match = xml.match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/i);

  if (match) {
    const rawTitle = cleanText(match[1]);
    const cleanT = rawTitle.split(" - ")[0];
    const vMatch = cleanT.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    const versionStr = vMatch ? `v${vMatch[1]}` : "Update Nou";

    return {
      id: cleanText(match[1]),
      hash: buildStableHash({ title: cleanText(match[1]), link: match[2] }),
      title: `${game.name} ${versionStr}`,
      link: match[2],
      excerpt: "Sursa: Sistemul oficial de articole Intel.",
      fullText: "Sursa: Sistemul oficial de articole Intel. Un nou update a fost detectat.",
      thumbnail: game.thumbnail,
      timestamp: new Date().toISOString()
    };
  }

  throw new Error("Acces refuzat la serverele Intel.");
}

async function fetchAmdUpdate(game) {
  const amdUrl = "https://www.amd.com/en/support/download/drivers.html";
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(amdUrl)}`;

  try {
    const res = await httpGet(proxyUrl);
    const html = String(res?.data?.contents || "");
    const versionMatch = html.match(/Adrenalin Edition\s+([\d\.]+)/i);

    if (versionMatch) {
      return {
        id: versionMatch[1],
        hash: buildStableHash({ version: versionMatch[1], link: amdUrl }),
        title: `AMD Radeon Adrenalin v${versionMatch[1]}`,
        link: amdUrl,
        excerpt: "Scanat direct de pe serverul amd.com. Un nou driver este disponibil.",
        fullText: "Scanat direct de pe serverul amd.com. Un nou driver Adrenalin este disponibil pentru descărcare.",
        thumbnail: game.thumbnail,
        timestamp: new Date().toISOString()
      };
    }
  } catch (err) {}

  const rssUrl = `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US&gl=US&ceid=US:en`;
  const fallbackRes = await httpGet(rssUrl);
  const match = String(fallbackRes.data).match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/i);

  if (match) {
    return {
      id: cleanText(match[1]),
      hash: buildStableHash({ title: cleanText(match[1]), link: match[2] }),
      title: cleanText(match[1]).split(" - ")[0],
      link: match[2],
      excerpt: "Sursa: Sistemul oficial de articole AMD.",
      fullText: "Sursa: Sistemul oficial de articole AMD. A fost detectat un articol nou cu update-uri.",
      thumbnail: game.thumbnail,
      timestamp: new Date().toISOString()
    };
  }

  throw new Error("Acces refuzat de protecția anti-bot a serverului AMD.");
}

// -------------------------------------------------------------
// FUNCȚIILE DE JOCURI
// -------------------------------------------------------------

async function fetchSteamUpdate(game) {
  const apiUrl = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=100&maxlength=25000&format=json`;
  const response = await httpGet(apiUrl);
  const newsItems = response?.data?.appnews?.newsitems;

  if (!Array.isArray(newsItems) || newsItems.length === 0) throw new Error("Lipsă date Steam.");

  const patchNotes = newsItems.filter((item) => {
    if (item.feed_type !== 1 && item.feedname !== "steam_community_announcements") return false;
    if (!isGoodSteamArticleUrl(item.url)) return false;
    return isLikelyPatchNote(item);
  });

  if (patchNotes.length === 0) throw new Error("Niciun update recent detectat direct de pe Steam.");

  patchNotes.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  const latest = patchNotes[0];

  if (!latest.gid || !latest.title) throw new Error("Update invalid primit de la Steam.");

  let rawContents = String(latest.contents || "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/\[[^\]]+\]/g, " ");

  const cleanExcerpt = cleanText(rawContents).slice(0, 700);
  const fullText = cleanText(rawContents).slice(0, 15000);

  return {
    id: String(latest.gid),
    hash: buildStableHash({ gid: String(latest.gid), title: cleanText(latest.title), date: latest.date }),
    title: cleanText(latest.title),
    link: String(latest.url).trim(),
    excerpt: cleanExcerpt || `A apărut un nou update pentru ${game.name}.`,
    fullText: fullText || cleanExcerpt,
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : undefined
  };
}

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length
    ? game.listingUrls
    : [game.listingUrl];

  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;
  let collected = [];

  for (const url of listingUrls) {
    const listRes = await httpGet(url);
    const listHtml = String(listRes.data || "");
    let anchors = parseAnchors(listHtml, game.baseUrl);

    anchors = anchors.filter((a) => {
      if (!a.href) return false;
      if (hrefRegex && !hrefRegex.test(a.href)) return false;
      if (!keywords.length) return true;
      return scoreCandidate(a, keywords) > 0;
    });

    collected.push(...anchors);
  }

  collected = uniqueByHref(collected);
  if (keywords.length) {
    collected.sort((a, b) => scoreCandidate(b, keywords) - scoreCandidate(a, keywords));
  }

  if (!collected.length) throw new Error(`Nu am găsit articole de update pentru ${game.name}.`);

  const articleUrl = collected[0].href;
  const articleRes = await httpGet(articleUrl);
  const articleHtml = String(articleRes.data || "");

  let cleanHtml = articleHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  cleanHtml = cleanHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  const shortExcerpt = extractDescriptionFromHtml(articleHtml).slice(0, 700) || `A apărut un nou update oficial pentru ${game.name}.`;
  const fullText = cleanText(cleanHtml).slice(0, 15000);
  const title = extractTitleFromHtml(articleHtml) || `Update nou pentru ${game.name}`;
  const timestamp = extractPublishedTimeFromHtml(articleHtml);

  return {
    id: String(articleUrl),
    hash: buildStableHash({ articleUrl, title, timestamp }),
    title: title,
    link: articleUrl,
    excerpt: shortExcerpt,
    fullText: fullText,
    image: extractImageFromHtml(articleHtml),
    thumbnail: game.thumbnail || undefined,
    timestamp: timestamp
  };
}

async function fetchMinecraftUpdate() {
  const manifestRes = await httpGet("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const latestVersion = manifestRes?.data?.latest?.release;
  if (!latestVersion) throw new Error("Date lipsă pe serverul Mojang.");

  const formattedVersion = latestVersion.replace(/\./g, "-");
  const excerpt = `O nouă versiune oficială (${latestVersion}) este disponibilă!`;

  return {
    id: String(latestVersion),
    hash: buildStableHash({ latestVersion }),
    title: `Minecraft: Java Edition ${latestVersion}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${formattedVersion}`,
    excerpt: excerpt,
    fullText: excerpt,
    image: "https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/MCV-keyart-default.jpg",
    thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg",
    timestamp: new Date().toISOString()
  };
}

async function fetchEpicGamesUpdate(game) {
  return await fetchListingBasedUpdate(game);
}

async function fetchFortniteUpdate() {
  try {
    const epicApiUrl = "https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US";
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(epicApiUrl)}`;
    const res = await httpGet(proxyUrl, { timeout: 20000 });
    const data = JSON.parse(res?.data?.contents || "{}");
    const posts = data?.blogList;

    if (!Array.isArray(posts) || posts.length === 0) throw new Error("Date invalide primite de la Epic prin proxy.");

    const validPosts = posts.filter(p => p.slug && p.slug.trim() !== "" && p.slug.toLowerCase() !== "news");
    if (validPosts.length === 0) throw new Error("Nu am găsit articole valide.");

    let latest = validPosts.find((p) => {
      const t = String(p.title).toLowerCase();
      return t.includes("update") || t.includes("patch") || t.includes("v") || p.category === "Patch Notes";
    });

    if (!latest) latest = validPosts[0];

    const shortExcerpt = cleanText(latest.shareDescription || "A apărut o nouă actualizare oficială.").slice(0, 700);
    const fullText = cleanText(latest.content || latest.shareDescription).slice(0, 15000);

    return {
      id: String(latest._id || latest.slug),
      hash: buildStableHash({ id: String(latest._id || latest.slug), title: cleanText(latest.title), date: latest.date }),
      title: cleanText(latest.title) || "Fortnite Update",
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: shortExcerpt,
      fullText: fullText,
      image: latest.image || latest.trendingImage,
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date ? new Date(latest.date).toISOString() : new Date().toISOString()
    };
  } catch (error) {
    const backupUrl = "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Dsite%3Afortnite.com%2Fnews%2Bupdate%26hl%3Den-US%26gl%3DUS%26ceid%3DUS%3Aen";
    const fallbackRes = await httpGet(backupUrl);
    const items = fallbackRes?.data?.items;

    if (!Array.isArray(items) || items.length === 0) throw new Error("Toate metodele pentru Fortnite au eșuat.");

    const latestBackup = items[0];
    const excerpt = "A apărut un nou articol oficial de actualizare pe site-ul Fortnite.";

    return {
      id: String(latestBackup.guid || latestBackup.link),
      hash: buildStableHash({ guid: String(latestBackup.guid || latestBackup.link), title: cleanText(latestBackup.title), pubDate: latestBackup.pubDate }),
      title: cleanText(latestBackup.title).replace(/\s-\sFortnite$/i, "").trim() || "Fortnite: Noutăți",
      link: latestBackup.link || "https://www.fortnite.com/news",
      excerpt: excerpt,
      fullText: excerpt,
      image: "https://cdn2.unrealengine.com/14br-consoles-1920x1080-1920x1080-4954ecbc82b3.jpg",
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latestBackup.pubDate ? new Date(latestBackup.pubDate).toISOString() : new Date().toISOString()
    };
  }
}

async function fetchRobloxUpdate() {
  const res = await httpGet("https://clientsettings.roblox.com/v2/client-version/WindowsPlayer");
  const version = res?.data?.clientVersionUpload;
  if (!version) throw new Error("Nu am putut accesa serverul de update Roblox.");

  const excerpt = `Un nou client oficial Roblox a fost urcat pe servere (versiunea: ${version}).`;

  return {
    id: String(version),
    hash: buildStableHash({ version }),
    title: "Roblox Client Update",
    link: "https://en.help.roblox.com/hc/en-us/articles/203312870-Update-Log",
    excerpt: excerpt,
    fullText: excerpt,
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg",
    timestamp: new Date().toISOString()
  };
}

// -------------------------------------------------------------
// REDUCERI - EXTRAGERE PE PLATFORME
// -------------------------------------------------------------

async function fetchDealsForStore(storeID, storeName) {
  const targetUrl = `https://www.cheapshark.com/api/1.0/deals?storeID=${storeID}&onSale=1&pageSize=50`;
  let deals = null;

  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    const res = await httpGet(proxyUrl);
    if (res?.data?.contents) deals = JSON.parse(res.data.contents);
  } catch (err) {}

  if (!Array.isArray(deals) || deals.length === 0) {
    try {
      const proxyUrl2 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
      const res2 = await httpGet(proxyUrl2);
      if (Array.isArray(res2.data)) deals = res2.data;
    } catch (err) {}
  }

  if (!Array.isArray(deals) || deals.length === 0) {
    try {
      const res3 = await httpGet(targetUrl, {
        headers: { "Accept": "application/json" }
      });
      if (Array.isArray(res3.data)) deals = res3.data;
    } catch (err) {}
  }

  if (!Array.isArray(deals) || deals.length === 0) return [];

  const validDeals = deals.filter(d => {
    const savings = parseFloat(d.savings) || 0;
    const salePrice = parseFloat(d.salePrice) || 0;
    const isFree = salePrice === 0;
    const steamRating = parseFloat(d.steamRatingPercent) || 0;
    const metacritic = parseInt(d.metacriticScore) || 0;

    if (storeID === 25) {
      return (savings >= 70 || isFree);
    }

    return (savings >= 70 || isFree) && (steamRating >= 70 || metacritic > 0 || isFree);
  });

  let sortedDeals = validDeals.map(d => ({
    id: d.dealID,
    hash: buildStableHash({ id: d.dealID, store: storeName }),
    steamAppID: d.steamAppID,
    title: d.title || "Joc Necunoscut",
    salePrice: d.salePrice || "0.00",
    normalPrice: d.normalPrice || "0.00",
    savings: Math.round(parseFloat(d.savings) || 0),
    store: storeName,
    link: storeID === 1 ? `https://store.steampowered.com/app/${d.steamAppID}` : `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
    thumbnail: d.thumb || null,
    popularityScore: (parseInt(d.steamRatingCount) || 0) + ((parseInt(d.metacriticScore) || 0) * 100),
    steamRatingText: d.steamRatingText || "Fără rating"
  }));

  sortedDeals.sort((a, b) => b.popularityScore - a.popularityScore);
  return sortedDeals.slice(0, 25);
}

async function fetchDeals() {
  const steamDeals = await fetchDealsForStore(1, "Steam");
  const epicDeals = await fetchDealsForStore(25, "Epic Games");

  const finalTop50 = [...steamDeals, ...epicDeals];

  if (finalTop50.length === 0) throw new Error("Nu s-au putut extrage oferte valide de pe Steam sau Epic.");

  return finalTop50;
}

async function enrichDealData(deal) {
  deal.endDateStr = "Nespecificat";
  deal.extraDetails = "";

  if (deal.store === "Steam" && deal.steamAppID) {
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}`;
      const res = await httpGet(url, { timeout: 5000 });
      const data = res.data[deal.steamAppID]?.data;

      if (data) {
        if (data.release_date && data.release_date.date) {
          deal.extraDetails += `\n**Lansare:** ${data.release_date.date}`;
        }

        if (data.platforms) {
          const plats = [];
          if (data.platforms.windows) plats.push("Windows");
          if (data.platforms.mac) plats.push("Mac");
          if (data.platforms.linux) plats.push("Linux");
          if (plats.length > 0) deal.extraDetails += `\n**Platforme:** ${plats.join(", ")}`;
        }
      }

      const htmlRes = await httpGet(deal.link, {
        timeout: 5000,
        headers: {
          "Cookie": "strLanguage=english; birthtime=283993201; mature_content=1;"
        }
      });

      const match = String(htmlRes.data || "").match(/Offer ends\s+([^<]+)/i);
      if (match && match[1]) {
        deal.endDateStr = match[1].trim();
      }
    } catch (e) {}
  } else if (deal.store === "Epic Games") {
    try {
      let cleanTitle = deal.title.replace(/(Standard|Deluxe|Ultimate|Edition)/gi, "").trim();
      if (cleanTitle.split(" ").length > 4) {
        cleanTitle = cleanTitle.split(" ").slice(0, 4).join(" ");
      }

      const epicQuery = {
        query: `query searchStoreQuery($keywords: String!) { Catalog { searchStore(keywords: $keywords, count: 3, country: "US", locale: "en-US") { elements { title price(country: "US") { lineOffers { appliedRules { endDate } } } promotions { promotionalOffers { promotionalOffers { endDate } } } } } } }`,
        variables: { keywords: cleanTitle }
      };

      const response = await httpPost("https://graphql.epicgames.com/graphql", epicQuery, {
        timeout: 8000,
        headers: { "Content-Type": "application/json" }
      });

      const elements = response.data?.data?.Catalog?.searchStore?.elements;
      if (elements && elements.length > 0) {
        let endDateIso = null;

        for (const item of elements) {
          const promoOffers = item.promotions?.promotionalOffers;
          if (promoOffers && promoOffers.length > 0 && promoOffers[0].promotionalOffers && promoOffers[0].promotionalOffers.length > 0) {
            endDateIso = promoOffers[0].promotionalOffers[0].endDate;
            break;
          }

          if (item.price?.lineOffers && item.price.lineOffers.length > 0) {
            const rules = item.price.lineOffers[0].appliedRules;
            if (rules && rules.length > 0 && rules[0].endDate) {
              endDateIso = rules[0].endDate;
              break;
            }
          }
        }

        if (endDateIso) {
          const d = new Date(endDateIso);
          if (!isNaN(d.getTime())) {
            const monthsRo = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
            const hr = d.getHours().toString().padStart(2, "0");
            const min = d.getMinutes().toString().padStart(2, "0");
            deal.endDateStr = `${d.getDate()} ${monthsRo[d.getMonth()]} ${d.getFullYear()} ${hr}:${min}`;
          }
        }
      }
    } catch (err) {
      console.error("Eroare la preluarea datei din API Epic:", err.message);
    }
  }

  return deal;
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL
// fetching separat logic de sending
// -------------------------------------------------------------

async function fetchGameUpdate(game) {
  if (!game.type || game.type === "steam") return await fetchSteamUpdate(game);
  if (game.type === "minecraft") return await fetchMinecraftUpdate();
  if (game.key === "fortnite") return await fetchFortniteUpdate();
  if (game.type === "epic_games" && game.key !== "fortnite") return await fetchEpicGamesUpdate(game);
  if (game.type === "roblox") return await fetchRobloxUpdate();
  if (game.type === "listing_based") return await fetchListingBasedUpdate(game);
  if (game.type === "nvidia") return await fetchNvidiaUpdate(game);
  if (game.type === "intel") return await fetchIntelUpdate(game);
  if (game.type === "amd") return await fetchAmdUpdate(game);

  throw new Error(`Tip de joc necunoscut pentru ${game.name}.`);
}

async function fetchGameEvent(game) {
  const latest = await fetchGameUpdate(game);
  return {
    gameKey: game.key,
    gameName: game.name,
    latest
  };
}

async function getLatestForAllGames() {
  const results = [];
  for (const game of config.games) {
    try {
      const latest = await fetchGameUpdate(game);
      results.push({ game, latest, error: null });
    } catch (error) {
      results.push({ game, latest: null, error: error.message });
    }
  }
  return results;
}

function findGameFromText(text) {
  const search = text.toLowerCase().trim();
  return config.games.find((game) => {
    const key = String(game.key || "").toLowerCase();
    const name = String(game.name || "").toLowerCase();
    return key === search || name === search || name.includes(search);
  });
}

// -------------------------------------------------------------
// TRIMITERE NOTIFICĂRI
// -------------------------------------------------------------

async function sendUpdateNotification(channelId, gameName, latest) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  await channel.send({
    embeds: [buildUpdateEmbed(gameName, latest)]
  });
}

async function sendDealNotification(channelId, deal) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  await channel.send({
    embeds: [buildDealEmbed(deal)]
  });
}

// -------------------------------------------------------------
// LOGICĂ MULTI-SERVER
// -------------------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function initializeSeenForGuildCurrentGames(guildId) {
  const state = await loadState();
  const guildState = ensureGuildState(state, guildId);

  for (const game of config.games) {
    try {
      const latest = await fetchGameUpdate(game);
      guildState.seen[game.key] = {
        id: latest.id,
        hash: latest.hash || latest.id
      };
    } catch (error) {
      console.error(`Nu am putut inițializa ${game.name} pentru guild ${guildId}: ${error.message}`);
    }
  }

  await saveState(state);
}

async function checkForUpdates() {
  const state = await loadState();
  const activeGuildEntries = Object.entries(state.guilds).filter(
    ([, guildState]) => guildState.subscribed && guildState.notificationChannelId
  );

  if (activeGuildEntries.length === 0) return false;

  let foundSomething = false;

  for (const game of config.games) {
    try {
      const event = await fetchGameEvent(game);
      const latest = event.latest;
      const latestMarker = {
        id: latest.id,
        hash: latest.hash || latest.id
      };

      for (const [guildId] of activeGuildEntries) {
        const guildState = ensureGuildState(state, guildId);
        const previous = guildState.seen[game.key];

        if (!previous) {
          guildState.seen[game.key] = latestMarker;
          continue;
        }

        const changed = previous.id !== latestMarker.id || previous.hash !== latestMarker.hash;

        if (changed) {
          guildState.seen[game.key] = latestMarker;
          foundSomething = true;

          try {
            await sendUpdateNotification(guildState.notificationChannelId, game.name, latest);
          } catch (error) {
            console.error(`Nu am putut trimite update pentru ${game.name} pe serverul ${guildId}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error(`Eroare la ${game.name}: ${error.message}`);
    }
  }

  await saveState(state);
  return foundSomething;
}

async function checkForDiscounts() {
  const state = await loadState();
  const activeGuildEntries = Object.entries(state.guilds).filter(
    ([, guildState]) => guildState.discountsSubscribed && guildState.discountChannelId
  );
  if (activeGuildEntries.length === 0) return false;

  try {
    const deals = await fetchDeals();
    let newDealsFound = false;

    for (const rawDeal of deals) {
      for (const [guildId] of activeGuildEntries) {
        const guildState = ensureGuildState(state, guildId);

        if (!guildState.seenDiscounts.includes(rawDeal.id)) {
          guildState.seenDiscounts.push(rawDeal.id);
          if (guildState.seenDiscounts.length > 300) {
            guildState.seenDiscounts = guildState.seenDiscounts.slice(-300);
          }

          try {
            const enriched = await enrichDealData({ ...rawDeal });
            await sendDealNotification(guildState.discountChannelId, enriched);
            newDealsFound = true;
          } catch (err) {
            console.error(`Nu am putut trimite reducerea ${rawDeal.title} pe serverul ${guildId}:`, err.message);
          }
        }
      }
    }

    await saveState(state);
    return newDealsFound;
  } catch (error) {
    console.error("Eroare la căutarea reducerilor:", error.message);
    return false;
  }
}

// -------------------------------------------------------------
// SLASH COMMANDS
// -------------------------------------------------------------

function getSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Verifică dacă botul este online."),

    new SlashCommandBuilder()
      .setName("games")
      .setDescription("Afișează lista jocurilor monitorizate."),

    new SlashCommandBuilder()
      .setName("porecle")
      .setDescription("Afișează poreclele jocurilor pentru căutare rapidă."),

    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Afișează meniul de ajutor."),

    new SlashCommandBuilder()
      .setName("start-updates")
      .setDescription("Pornește notificările automate de update-uri pe canalul curent.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("stop-updates")
      .setDescription("Oprește notificările automate de update-uri.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("start-reduceri")
      .setDescription("Pornește notificările automate pentru reduceri pe canalul curent.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("stop-reduceri")
      .setDescription("Oprește notificările automate pentru reduceri.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("latest-updates")
      .setDescription("Afișează cele mai noi update-uri pentru toate jocurile."),

    new SlashCommandBuilder()
      .setName("latest-update")
      .setDescription("Afișează cel mai recent update pentru un joc.")
      .addStringOption((option) =>
        option
          .setName("joc")
          .setDescription("Porecla sau numele jocului")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("latest-reduceri")
      .setDescription("Afișează cele mai bune reduceri disponibile acum.")
  ].map((cmd) => cmd.toJSON());
}

async function registerSlashCommands() {
  const commands = getSlashCommands();

  if (process.env.DEV_GUILD_ID) {
    const guild = await client.guilds.fetch(process.env.DEV_GUILD_ID);
    await guild.commands.set(commands);
    console.log(`✅ Slash commands înregistrate pe guild-ul de test ${process.env.DEV_GUILD_ID}.`);
    return;
  }

  await client.application.commands.set(commands);
  console.log("✅ Slash commands globale înregistrate.");
}

function generateButtons(prefix, currentPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}_next`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage >= totalPages - 1)
  );
}

async function sendPagedEmbeds(interaction, embeds, titleText, prefix) {
  const itemsPerPage = 5;
  const totalPages = Math.ceil(embeds.length / itemsPerPage);

  if (totalPages === 0) {
    await interaction.editReply("❌ Nu există date de afișat.");
    return;
  }

  let currentPage = 0;

  const getPageEmbeds = (pageIndex) => {
    const startIndex = pageIndex * itemsPerPage;
    return embeds.slice(startIndex, startIndex + itemsPerPage);
  };

  const replyMsg = await interaction.editReply({
    content: titleText,
    embeds: getPageEmbeds(currentPage),
    components: totalPages > 1 ? [generateButtons(prefix, currentPage, totalPages)] : [],
    fetchReply: true
  });

  if (totalPages <= 1) return;

  const collector = replyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300000
  });

  collector.on("collect", async (btnInteraction) => {
    if (btnInteraction.user.id !== interaction.user.id) {
      return btnInteraction.reply({
        content: "Doar utilizatorul care a pornit comanda poate folosi butoanele.",
        ephemeral: true
      });
    }

    if (btnInteraction.customId === `${prefix}_prev`) currentPage--;
    if (btnInteraction.customId === `${prefix}_next`) currentPage++;

    await btnInteraction.deferUpdate();
    await btnInteraction.editReply({
      embeds: getPageEmbeds(currentPage),
      components: [generateButtons(prefix, currentPage, totalPages)]
    });
  });

  collector.on("end", () => {
    replyMsg.edit({ components: [] }).catch(() => null);
  });
}

// -------------------------------------------------------------
// EVENT HANDLERS
// -------------------------------------------------------------

let mainLoopHandle = null;
let isCheckingLoop = false;
let isShuttingDown = false;

async function mainLoop() {
  if (isCheckingLoop || isShuttingDown) return;
  isCheckingLoop = true;

  try {
    await checkForUpdates();
    await checkForDiscounts();
  } catch (error) {
    console.error("Eroare în Loop-ul principal:", error);
  } finally {
    isCheckingLoop = false;
  }
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`🛑 Primit ${signal}. Închid botul grațios...`);

  try {
    if (mainLoopHandle) {
      clearInterval(mainLoopHandle);
      mainLoopHandle = null;
    }

    manualCache.clear();
    client.destroy();
    await mongoose.connection.close();

    console.log("✅ Shutdown complet.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Eroare la shutdown:", error);
    process.exit(1);
  }
}

client.once("ready", async () => {
  console.log("🤖 Botul este online și așteaptă comenzi.");
  console.log(`Conectat ca: ${client.user.tag}`);

  try {
    await registerSlashCommands();
  } catch (error) {
    console.error("❌ Nu am putut înregistra slash commands:", error);
  }

  mainLoopHandle = setInterval(async () => {
    await mainLoop();
  }, Number(config.checkIntervalMinutes || 30) * 60 * 1000);

  await mainLoop();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    return interaction.reply({ content: "❌ Comenzile funcționează doar pe servere.", ephemeral: true });
  }

  const guildId = interaction.guildId;

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply("Pong! 🏓 Sistemele sunt operaționale.");
      return;
    }

    if (interaction.commandName === "games") {
      await interaction.reply({
        content: `🎮 **Jocuri urmărite:**\n${config.games.map((g) => `- **${g.name}**`).join("\n")}`
      });
      return;
    }

    if (interaction.commandName === "porecle") {
      const list = config.games.map((g) => `**${g.name}** -> folosește porecla: \`${g.key}\``).join("\n");
      await interaction.reply({
        content:
          `🏷️ **Lista de porecle pentru jocuri:**\n` +
          `Pentru a vedea ultimul update al unui joc specific, folosește comanda \`/latest-update joc:[poreclă]\`.\n\n${list}`
      });
      return;
    }

    if (interaction.commandName === "help") {
      const helpEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle("📚 Manualul Botului - Meniul de Ajutor")
        .setDescription("Iată lista completă a comenzilor și explicația exactă a ceea ce face fiecare:")
        .addFields(
          {
            name: "`/start-updates`",
            value: "Setează canalul curent pentru notificările automate de update-uri."
          },
          {
            name: "`/stop-updates`",
            value: "Oprește notificările automate de update-uri."
          },
          {
            name: "`/start-reduceri`",
            value: "Setează canalul curent pentru notificările automate de reduceri."
          },
          {
            name: "`/stop-reduceri`",
            value: "Oprește notificările automate de reduceri."
          },
          {
            name: "`/latest-updates`",
            value: "Afișează cele mai recente update-uri pentru toate jocurile monitorizate."
          },
          {
            name: "`/latest-update`",
            value: "Afișează ultimul update pentru un joc specific."
          },
          {
            name: "`/latest-reduceri`",
            value: "Afișează manual cele mai bune reduceri disponibile acum."
          },
          {
            name: "`/games`",
            value: "Afișează lista tuturor jocurilor și driverelor monitorizate."
          },
          {
            name: "`/porecle`",
            value: "Afișează poreclele pentru căutarea rapidă a jocurilor."
          },
          {
            name: "`/ping`",
            value: "Testează dacă botul este online."
          }
        )
        .setFooter({ text: "Pentru orice eroare, contactează administratorul." })
        .setTimestamp();

      await interaction.reply({ embeds: [helpEmbed] });
      return;
    }

    if (interaction.commandName === "start-updates") {
      await interaction.deferReply({ ephemeral: true });

      const state = await loadState();
      const guildState = ensureGuildState(state, guildId);

      guildState.notificationChannelId = interaction.channelId;
      guildState.subscribed = true;

      await saveState(state);
      await initializeSeenForGuildCurrentGames(guildId);

      await interaction.editReply("✅ Am pornit notificările automate de update-uri pe acest canal pentru acest server.");
      return;
    }

    if (interaction.commandName === "stop-updates") {
      await interaction.deferReply({ ephemeral: true });

      const state = await loadState();
      const guildState = ensureGuildState(state, guildId);
      guildState.subscribed = false;
      await saveState(state);

      await interaction.editReply("🛑 Am oprit notificările automate de update-uri pentru acest server.");
      return;
    }

    if (interaction.commandName === "start-reduceri") {
      await interaction.deferReply({ ephemeral: true });

      const state = await loadState();
      const guildState = ensureGuildState(state, guildId);

      guildState.discountChannelId = interaction.channelId;
      guildState.discountsSubscribed = true;

      await saveState(state);
      await interaction.editReply("✅ Am activat alertele pentru reduceri masive pe acest canal!");
      return;
    }

    if (interaction.commandName === "stop-reduceri") {
      await interaction.deferReply({ ephemeral: true });

      const state = await loadState();
      const guildState = ensureGuildState(state, guildId);
      guildState.discountsSubscribed = false;
      await saveState(state);

      await interaction.editReply("🛑 Am oprit notificările pentru reduceri pe acest server.");
      return;
    }

    if (interaction.commandName === "latest-updates") {
      await interaction.deferReply();

      const state = await loadState();
      const estMs = state.executionTimes?.all || 15000;
      const startTime = Date.now();

      const results = await manualCache.getOrSet("latest_updates_all", 120000, async () => {
        return await getLatestForAllGames();
      });

      const elapsed = Date.now() - startTime;
      state.executionTimes["all"] = Math.round((estMs + elapsed) / 2);
      await saveState(state);

      const validResults = results.filter(r => r.latest !== null);
      if (validResults.length === 0) {
        await interaction.editReply("❌ Nu am putut prelua update-uri pentru niciun joc.");
        return;
      }

      const embeds = validResults.map((r, index) => {
        const emb = buildUpdateEmbed(r.game.name, r.latest);
        emb.setFooter({ text: `${r.game.name} • ${index + 1}/${validResults.length}` });
        return emb;
      });

      await sendPagedEmbeds(
        interaction,
        embeds,
        `✅ **Cele mai recente update-uri (${validResults.length} jocuri monitorizate):**`,
        "upd"
      );
      return;
    }

    if (interaction.commandName === "latest-update") {
      await interaction.deferReply();

      const state = await loadState();
      const estMs = state.executionTimes?.single || 2000;
      const startTime = Date.now();

      const gameText = interaction.options.getString("joc", true);
      const game = findGameFromText(gameText);

      if (!game) {
        await interaction.editReply("❌ Nu am găsit jocul. Folosește `/porecle` pentru lista exactă.");
        return;
      }

      try {
        const latest = await manualCache.getOrSet(`latest_update_${game.key}`, 60000, async () => {
          return await fetchGameUpdate(game);
        });

        const elapsed = Date.now() - startTime;
        state.executionTimes["single"] = Math.round((estMs + elapsed) / 2);
        await saveState(state);

        await interaction.editReply({
          content: `✅ Ultimul update pentru **${game.name}**:`,
          embeds: [buildUpdateEmbed(game.name, latest)]
        });
      } catch (error) {
        await interaction.editReply(`❌ Nu am putut lua ultimul update pentru **${game.name}**.`);
      }

      return;
    }

    if (interaction.commandName === "latest-reduceri") {
      await interaction.deferReply();

      const state = await loadState();
      const estMs = state.executionTimes?.reduceri || 15000;
      const startTime = Date.now();

      const deals = await manualCache.getOrSet("latest_deals", 180000, async () => {
        const rawDeals = await fetchDeals();
        const topDeals = rawDeals.slice(0, 50);
        return await Promise.all(topDeals.map((deal) => enrichDealData({ ...deal })));
      });

      const elapsed = Date.now() - startTime;
      state.executionTimes["reduceri"] = Math.round((estMs + elapsed) / 2);
      await saveState(state);

      if (!deals || deals.length === 0) {
        await interaction.editReply("❌ Nu am găsit nicio ofertă activă.");
        return;
      }

      const embeds = deals.map((deal, index) => {
        const emb = buildDealEmbed(deal);
        emb.setFooter({ text: `${index + 1}/${deals.length}` });
        return emb;
      });

      await sendPagedEmbeds(
        interaction,
        embeds,
        `✅ **Top ${deals.length} oferte Steam & Epic găsite:**`,
        "deals"
      );

      return;
    }
  } catch (error) {
    console.error("Eroare la interactionCreate:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ A apărut o eroare internă.").catch(() => null);
    } else {
      await interaction.reply({
        content: "❌ A apărut o eroare internă.",
        ephemeral: true
      }).catch(() => null);
    }
  }
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error);
  process.exit(1);
});
