const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
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
// 1. SETĂRI GLOBALE
// -------------------------------------------------------------
const PREFIX = "big_master!";
let config;

try {
  const CONFIG_PATH = path.join(__dirname, "config.json");
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch (err) {
  console.error("❌ Eroare critică la citirea config.json:", err.message);
  process.exit(1);
}

// -------------------------------------------------------------
// 2. VALIDARE CONFIG LA BOOT (STRICTĂ & COMPLETĂ)
// -------------------------------------------------------------
function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateConfig() {
  console.log("🛠️ Se validează config.json...");

  const interval = Number(config.checkIntervalMinutes);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("CRITIC: checkIntervalMinutes trebuie să fie un număr pozitiv.");
  }

  if (!Array.isArray(config.games) || config.games.length === 0) {
    throw new Error("CRITIC: config.games trebuie să fie un array nevid!");
  }

  const seenKeys = new Set();

  for (const game of config.games) {
    if (!game.key || !game.name || !game.type) {
      throw new Error(`CRITIC: Joc invalid (lipsesc key, name sau type): ${JSON.stringify(game)}`);
    }

    if (seenKeys.has(game.key)) {
      throw new Error(`CRITIC: Cheia duplicată "${game.key}" în config.`);
    }
    seenKeys.add(game.key);

    if (game.thumbnail && !isValidUrl(game.thumbnail)) {
      throw new Error(`CRITIC: Thumbnail invalid pentru "${game.name}"`);
    }

    if (game.type === "steam" && !game.appId) {
      throw new Error(`CRITIC: Jocul Steam "${game.name}" nu are appId setat!`);
    }

    if (game.type === "intel" && (!game.url || !isValidUrl(game.url))) {
      throw new Error(`CRITIC: Jocul Intel "${game.name}" nu are URL valid!`);
    }

    if (game.type === "listing_based") {
      if (!Array.isArray(game.listingUrls) || game.listingUrls.length === 0) {
        throw new Error(`CRITIC: Jocul "${game.name}" nu are listingUrls valid.`);
      }

      for (const url of game.listingUrls) {
        if (!isValidUrl(url)) {
          throw new Error(`CRITIC: listingUrl invalid pentru "${game.name}": ${url}`);
        }
      }

      if (!game.baseUrl || !isValidUrl(game.baseUrl)) {
        throw new Error(`CRITIC: baseUrl invalid pentru "${game.name}"`);
      }

      if (game.articleHrefRegex) {
        try {
          new RegExp(game.articleHrefRegex, "i");
        } catch (e) {
          throw new Error(`CRITIC: articleHrefRegex invalid pentru "${game.name}": ${e.message}`);
        }
      }
    }
  }
  console.log("✅ Configurația jocurilor este validă.");
}
validateConfig();

// -------------------------------------------------------------
// 3. DEFINIRE SCHEME MONGODB ȘI CLIENT DISCORD
// -------------------------------------------------------------

const guildSchema = new mongoose.Schema({
  _id: String, // Reprezintă ID-ul serverului de Discord (guildId)
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: Object, default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: Array, default: [] }
}, { minimize: false });

const GuildModel = mongoose.model("Guild", guildSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: {
    type: Object,
    default: { all: 15000, single: 2000, reduceri: 15000 }
  }
}, { minimize: false });

const SystemModel = mongoose.model("System", systemSchema);

async function getGuildConfig(guildId) {
  let guild = await GuildModel.findById(guildId).lean();
  if (!guild) {
    guild = { _id: guildId, subscribed: false, notificationChannelId: null, seen: {}, discountsSubscribed: false, discountChannelId: null, seenDiscounts: [] };
  }
  return guild;
}

async function saveGuildConfig(guildId, data) {
  await GuildModel.findByIdAndUpdate(guildId, { $set: data }, { upsert: true });
}

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
// 4. SHUTDOWN GRACEFUL & HANDLERE GLOBALE DE ERORI
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

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

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
  single: {}
};

let isChecking = false;

function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) cache.updates.data = null;
  if (cache.deals.expiresAt < now) cache.deals.data = null;

  for (const key in cache.single) {
    if (cache.single[key].expiresAt < now) {
      delete cache.single[key];
    }
  }
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

function absoluteUrl(base, maybeRelative) {
  if (!maybeRelative) return "";
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return "";
  }
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
    if (!Number.isNaN(date.getTime())) {
      embed.setTimestamp(date);
    }
  }
  return embed;
}

function findGameFromText(text) {
  const search = text.toLowerCase().trim();
  if (search.length < 2) return null;

  let bestMatch = null;
  let bestScore = -1;

  for (const game of config.games) {
    const key = String(game.key || "").toLowerCase();
    const name = String(game.name || "").toLowerCase();

    if (key === search || name === search) {
      return game;
    }

    if (name.startsWith(search) || key.startsWith(search)) {
      if (bestScore < 2) {
        bestScore = 2;
        bestMatch = game;
      }
    } else if (name.includes(search) || key.includes(search)) {
      if (bestScore < 1) {
        bestScore = 1;
        bestMatch = game;
      }
    }
  }

  return bestMatch;
}

// -------------------------------------------------------------
// HELPER REQUEST CU RETRY ȘI TIMEOUT
// -------------------------------------------------------------
async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
  const reqConfig = {
    method,
    url,
    timeout: options.timeout || 15000,
    headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
  };
  if (options.data) reqConfig.data = options.data;

  for (let i = 0; i <= retries; i++) {
    try {
      return await axios(reqConfig);
    } catch (err) {
      const status = err.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }
      if (i === retries) throw err;
      await new Promise(res => setTimeout(res, backoff));
      backoff *= 2;
    }
  }
}

// -------------------------------------------------------------
// FUNCȚII PENTRU DRIVERE
// -------------------------------------------------------------
async function fetchNvidiaUpdate(game) {
  const exactQuery = game.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${exactQuery} release`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpReq('GET', rssUrl);
  const xml = String(res.data || "");
  const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/i);

  if (itemMatch) {
    const itemXml = itemMatch[1];
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const rawTitle = titleMatch ? cleanText(titleMatch[1]) : `Update ${game.name}`;
    const cleanT = rawTitle.split(" - ")[0];
    const vMatch = cleanT.match(/\b(\d{3}\.\d{2})\b/);
    const versionStr = vMatch ? `v${vMatch[1]}` : "Update Nou";

    return {
      id: cleanT,
      title: `${game.name} ${versionStr}`,
      link: linkMatch ? linkMatch[1] : "https://www.nvidia.com/en-us/geforce/news/",
      excerpt: `Sursa: Sistemul oficial de articole NVIDIA.`,
      fullText: `Sursa: Sistemul oficial de articole NVIDIA. Noul driver ${versionStr} este disponibil.`,
      thumbnail: game.thumbnail,
      timestamp: dateMatch ? new Date(dateMatch[1]).toISOString() : ""
    };
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
      return {
        id: version,
        title: `${game.name} v${version}`,
        link: game.url,
        excerpt: `Extras direct de pe pagina oficială Intel.\n**Versiune găsită:** ${version}`,
        fullText: `Extras direct de pe pagina oficială Intel. Versiune nouă detectată: ${version}`,
        thumbnail: game.thumbnail,
        timestamp: ""
      };
    }
  } catch (err) {
    console.warn(`[Driver Fetch] Intel proxy failed pt ${game.name}:`, err.message);
  }

  const q = game.key === "intelpro" ? 'site:intel.com "Intel Arc Pro Graphics"' : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpReq('GET', rssUrl);
  const xml = String(res.data || "");
  const match = xml.match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/i);

  if (match) {
    return {
      id: cleanText(match[1]),
      title: cleanText(match[1]).split(" - ")[0],
      link: match[2],
      excerpt: "Sursa: Sistemul oficial de articole Intel.",
      fullText: "Sursa: Sistemul oficial de articole Intel. Un nou update a fost detectat.",
      thumbnail: game.thumbnail,
      timestamp: ""
    };
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
      return {
        id: match[1],
        title: `AMD Radeon Adrenalin v${match[1]}`,
        link: amdUrl,
        excerpt: "Scanat direct de pe serverul amd.com. Un nou driver este disponibil.",
        fullText: "Scanat direct de pe serverul amd.com. Un nou driver Adrenalin este disponibil pentru descărcare.",
        thumbnail: game.thumbnail,
        timestamp: ""
      };
    }
  } catch (err) {
    console.warn(`[Driver Fetch] AMD proxy failed pt ${game.name}:`, err.message);
  }

  const rssUrl = `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US&gl=US&ceid=US:en`;
  const res = await httpReq('GET', rssUrl);
  const match = String(res.data).match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/i);

  if (match) {
    return {
      id: cleanText(match[1]),
      title: cleanText(match[1]).split(" - ")[0],
      link: match[2],
      excerpt: "Sursa: Sistemul oficial de articole AMD.",
      fullText: "Sursa: Sistemul oficial de articole AMD. A fost detectat un articol nou cu update-uri.",
      thumbnail: game.thumbnail,
      timestamp: ""
    };
  }

  throw new Error("Acces refuzat de protecția anti-bot AMD.");
}

// -------------------------------------------------------------
// FUNCȚIILE DE JOCURI
// -------------------------------------------------------------
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
  const cleanExcerpt = cleanText(rawContents).slice(0, 700);

  return {
    id: String(latest.gid),
    title: cleanText(latest.title),
    link: String(latest.url).trim(),
    excerpt: cleanExcerpt || `A apărut un nou update pentru ${game.name}.`,
    fullText: cleanText(rawContents).slice(0, 15000) || cleanExcerpt,
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : ""
  };
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
  const shortExcerpt = cleanText(ogDesc).slice(0, 700) || `A apărut un nou update oficial pentru ${game.name}.`;

  return {
    id: String(articleUrl),
    title: cleanText(ogTitle) || `Update nou pentru ${game.name}`,
    link: articleUrl,
    excerpt: shortExcerpt,
    fullText: cleanText(cleanHtml).slice(0, 15000) || shortExcerpt,
    image: ogImg,
    thumbnail: game.thumbnail || undefined,
    timestamp: pubTime
  };
}

async function fetchMinecraftUpdate() {
  const res = await httpReq('GET', "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const latestVersion = res?.data?.latest?.release;
  if (!latestVersion) throw new Error("Date lipsă pe serverul Mojang.");

  const formattedVersion = latestVersion.replace(/\./g, "-");
  const excerpt = `O nouă versiune oficială (${latestVersion}) este disponibilă!`;

  return {
    id: String(latestVersion),
    title: `Minecraft: Java Edition ${latestVersion}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${formattedVersion}`,
    excerpt: excerpt,
    fullText: excerpt,
    image: "https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/MCV-keyart-default.jpg",
    thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg",
    timestamp: ""
  };
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
      return (
        t.includes("update") ||
        t.includes("patch") ||
        /\bv\d+(\.\d+)*\b/i.test(t) ||
        String(p.category || "").toLowerCase() === "patch notes"
      );
    });

    if (!latest) latest = validPosts[0];
    const shortExcerpt = cleanText(latest.shareDescription || "A apărut o nouă actualizare oficială.").slice(0, 700);

    return {
      id: String(latest._id || latest.slug),
      title: cleanText(latest.title) || "Fortnite Update",
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: shortExcerpt,
      fullText: cleanText(latest.content || latest.shareDescription).slice(0, 15000),
      image: latest.image || latest.trendingImage,
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date ? new Date(latest.date).toISOString() : ""
    };

  } catch (error) {
    console.warn("[Fortnite Fetch] API-ul Epic a eșuat. Execut fallback-ul pe RSS...");
    const backupUrl = "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Dsite%3Afortnite.com%2Fnews%2Bupdate%26hl%3Den-US";
    const fallbackRes = await httpReq('GET', backupUrl);
    const items = fallbackRes?.data?.items;

    if (!Array.isArray(items) || items.length === 0) throw new Error("Toate metodele pentru Fortnite au eșuat.");
    const latestBackup = items[0];
    const excerpt = "A apărut un nou articol oficial de actualizare pe site-ul Fortnite.";

    return {
      id: String(latestBackup.guid || latestBackup.link),
      title: cleanText(latestBackup.title).replace(/\s-\sFortnite$/i, "").trim() || "Fortnite: Noutăți",
      link: latestBackup.link || "https://www.fortnite.com/news",
      excerpt: excerpt,
      fullText: excerpt,
      image: "https://cdn2.unrealengine.com/14br-consoles-1920x1080-1920x1080-4954ecbc82b3.jpg",
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latestBackup.pubDate ? new Date(latestBackup.pubDate).toISOString() : ""
    };
  }
}

async function fetchRobloxUpdate() {
  const res = await httpReq('GET', "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer");
  const version = res?.data?.clientVersionUpload;
  if (!version) throw new Error("Nu am putut accesa serverul de update Roblox.");

  const excerpt = `Un nou client oficial Roblox a fost urcat pe servere (versiunea: ${version}).`;

  return {
    id: String(version),
    title: "Roblox Client Update",
    link: "https://en.help.roblox.com/hc/en-us/articles/203312870-Update-Log",
    excerpt: excerpt,
    fullText: excerpt,
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg",
    timestamp: ""
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
    const res = await httpReq('GET', proxyUrl);
    if (res?.data?.contents) deals = JSON.parse(res.data.contents);
  } catch (err) { console.warn("[Deals Fetch] AllOrigins failed:", err.message); }

  if (!Array.isArray(deals) || deals.length === 0) {
    try {
      const proxyUrl2 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
      const res2 = await httpReq('GET', proxyUrl2);
      if (Array.isArray(res2.data)) deals = res2.data;
    } catch (err) { console.warn("[Deals Fetch] CodeTabs failed:", err.message); }
  }

  if (!Array.isArray(deals) || deals.length === 0) {
    try {
      const res3 = await httpReq('GET', targetUrl, { headers: { "Accept": "application/json" } });
      if (Array.isArray(res3.data)) deals = res3.data;
    } catch (err) { console.warn("[Deals Fetch] Direct failed:", err.message); }
  }

  if (!Array.isArray(deals) || deals.length === 0) return [];

  const validDeals = deals.filter(d => {
    const savings = parseFloat(d.savings) || 0;
    const salePrice = parseFloat(d.salePrice) || 0;
    const isFree = salePrice === 0;
    const steamRating = parseFloat(d.steamRatingPercent) || 0;
    const metacritic = parseInt(d.metacriticScore) || 0;

    if (storeID === 25) return (savings >= 70 || isFree);
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
    link: storeID === 1 ? `https://store.steampowered.com/app/${d.steamAppID}` : `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
    thumbnail: d.thumb || null,
    popularityScore: (parseInt(d.steamRatingCount) || 0) + ((parseInt(d.metacriticScore) || 0) * 100),
    endDateStr: "Nespecificat",
    extraDetails: "",
    enriched: false
  }));
}

async function fetchDeals() {
  const steamDeals = await fetchDealsForStore(1, "Steam");
  const epicDeals = await fetchDealsForStore(25, "Epic Games");

  const finalTop50 = [...steamDeals, ...epicDeals]
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, 50);

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

  } else if (deal.store === "Epic Games") {
    try {
      let cleanTitle = deal.title.replace(/(Standard|Deluxe|Ultimate|Edition)/gi, "").trim();
      if (cleanTitle.split(" ").length > 4) cleanTitle = cleanTitle.split(" ").slice(0, 4).join(" ");

      const epicQuery = {
        query: `query searchStoreQuery($keywords: String!) { Catalog { searchStore(keywords: $keywords, count: 3, country: "US", locale: "en-US") { elements { title price(country: "US") { lineOffers { appliedRules { endDate } } } promotions { promotionalOffers { promotionalOffers { endDate } } } } } } }`,
        variables: { keywords: cleanTitle }
      };

      const response = await httpReq('POST', "https://graphql.epicgames.com/graphql", { data: epicQuery, headers: { "Content-Type": "application/json" } });
      const elements = response.data?.data?.Catalog?.searchStore?.elements;

      if (elements && elements.length > 0) {
        let endDateIso = null;
        for (const item of elements) {
          const promoOffers = item.promotions?.promotionalOffers;
          if (promoOffers && promoOffers.length > 0 && promoOffers[0].promotionalOffers && promoOffers[0].promotionalOffers.length > 0) {
            endDateIso = promoOffers[0].promotionalOffers[0].endDate; break;
          }
          if (item.price?.lineOffers && item.price.lineOffers.length > 0) {
            const rules = item.price.lineOffers[0].appliedRules;
            if (rules && rules.length > 0 && rules[0].endDate) {
              endDateIso = rules[0].endDate; break;
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
    } catch (err) { console.warn(`[Enrich] Epic failed pt ${deal.title}:`, err.message); }
  }

  deal.enriched = true;
  return deal;
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL ȘI STRUCTURA DE EVENIMENTE
// -------------------------------------------------------------
async function fetchGameUpdate(game) {
  if (!game.type || game.type === "steam") return await fetchSteamUpdate(game);
  if (game.type === "minecraft") return await fetchMinecraftUpdate();
  if (game.key === "fortnite") return await fetchFortniteUpdate();
  if (game.type === "epic_games" && game.key !== "fortnite") return await fetchListingBasedUpdate(game);
  if (game.type === "roblox") return await fetchRobloxUpdate();
  if (game.type === "listing_based") return await fetchListingBasedUpdate(game);
  if (game.type === "nvidia") return await fetchNvidiaUpdate(game);
  if (game.type === "intel") return await fetchIntelUpdate(game);
  if (game.type === "amd") return await fetchAmdUpdate(game);

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

// FIX: BATCH UPDATE LA BAZA DE DATE PENTRU UPDATE-URI JOCURI
async function checkForUpdates() {
  const guilds = await GuildModel.find({ subscribed: true });
  if (guilds.length === 0) return;

  const results = await getLatestForAllGames();

  // Inversat loop-urile: Parcurgem Guild-urile întâi pentru a face un singur update DB per server
  for (const guildConfig of guilds) {
    if (!guildConfig.notificationChannelId) continue;
    if (!guildConfig.seen) guildConfig.seen = {};
    
    let isGuildChanged = false;

    for (const { game, latest, error } of results) {
      if (error || !latest) continue;

      if (guildConfig.seen[game.key] !== latest.id) {
        try {
          const channel = await client.channels.fetch(guildConfig.notificationChannelId);
          if (channel) {
            await channel.send({ embeds: [buildUpdateEmbed(game.name, latest)] });
          }
          guildConfig.seen[game.key] = latest.id;
          isGuildChanged = true;
        } catch (err) {
          console.warn(`[Updates] Send failed pe guild ${guildConfig._id} pt jocul ${game.name}:`, err.message);
        }
      }
    }

    // Un singur save in baza de date cu toate datele cumulate pentru acest guild
    if (isGuildChanged) {
      await GuildModel.updateOne(
        { _id: guildConfig._id },
        { $set: { seen: guildConfig.seen } }
      );
    }
  }
}

// FIX: BATCH UPDATE LA BAZA DE DATE PENTRU REDUCERI
async function checkForDiscounts() {
  const guilds = await GuildModel.find({ discountsSubscribed: true });
  if (guilds.length === 0) return;

  try {
    const deals = await fetchDeals();

    for (const guildConfig of guilds) {
      if (!guildConfig.discountChannelId) continue;
      if (!guildConfig.seenDiscounts) guildConfig.seenDiscounts = [];
      
      let isGuildChanged = false;

      for (const deal of deals) {
        if (!guildConfig.seenDiscounts.includes(deal.id)) {
          // Datele se îmbogățesc dinamic dacă un guild are nevoie de ele, dar se aplică pe obiectul din memorie o singură dată
          if (!deal.enriched) await enrichDealData(deal);

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

          if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);

          try {
            const channel = await client.channels.fetch(guildConfig.discountChannelId);
            if (channel) await channel.send({ embeds: [embed] });

            guildConfig.seenDiscounts.push(deal.id);
            isGuildChanged = true;
          } catch (e) {
            console.warn(`[Reduceri] Send failed pe guild ${guildConfig._id}:`, e.message);
          }
        }
      }

      // Un singur update pentru acest guild după ce s-au verificat toate ofertele
      if (isGuildChanged) {
        if (guildConfig.seenDiscounts.length > 300) guildConfig.seenDiscounts = guildConfig.seenDiscounts.slice(-300);
        await GuildModel.updateOne(
          { _id: guildConfig._id },
          { $set: { seenDiscounts: guildConfig.seenDiscounts } }
        );
      }
    }

  } catch (err) {
    console.error("Eroare la căutarea reducerilor:", err.message);
  }
}

// -------------------------------------------------------------
// EVENT HANDLERS
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
    } catch (err) {
      console.error("❌ Eroare în Loop-ul principal:", err);
    } finally {
      isChecking = false;
    }
  };

  runChecks();
  setInterval(runChecks, Number(config.checkIntervalMinutes || 30) * 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command1 = (args.shift() || "").toLowerCase();
  const command2 = (args[0] || "").toLowerCase();

  const guildId = message.guild.id;

  // FIX: S-a eliminat "cleanCache" din interiorul if(command1 === 'latest')

  if (command1 === "ping") {
    await message.reply("Pong! 🏓 Sistemele sunt operaționale.");
    return;
  }

  if (command1 === "games") {
    await message.reply(`🎮 Jocuri urmărite:\n${config.games.map((g) => `- ${g.name}`).join("\n")}`);
    return;
  }

  if (command1 === "porecle") {
    const list = config.games.map((g) => `${g.name} -> folosește porecla: ${g.key}`).join("\n");
    await message.reply(`🏷️ Lista de porecle pentru jocuri:\nPentru a vedea ultimul update al unui joc specific, folosește comanda \`${PREFIX}latest update [poreclă]\`.\n\n${list}`);
    return;
  }

  if (command1 === "start" && command2 === "updates") {
    args.shift();
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("⛔ Doar un administrator poate folosi comanda.");
    }

    let gCfg = await getGuildConfig(guildId);
    gCfg.notificationChannelId = message.channel.id;
    gCfg.subscribed = true;
    if (!gCfg.seen) gCfg.seen = {};

    const msg = await message.reply("⏳ Setez canalul și preiau istoricul jocurilor (ca să nu te spamez cu alerte vechi)...");

    const results = await getLatestForAllGames();
    for (const r of results) {
      if (r.latest) gCfg.seen[r.game.key] = r.latest.id;
    }

    await saveGuildConfig(guildId, gCfg);
    return msg.edit("✅ Am pornit notificările automate de update-uri pe acest canal pentru acest server.");
  }

  if (command1 === "stop" && command2 === "updates") {
    args.shift();
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un administrator poate folosi comanda.");

    await GuildModel.updateOne({ _id: guildId }, { $set: { subscribed: false } });
    return message.reply("🛑 Am oprit notificările automate de update pentru acest server.");
  }

  // FIX: Rezolvat problema de spam cu "valul mare de embeduri" la start reduceri
  if (command1 === "start" && command2 === "reduceri") {
    args.shift();
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un administrator poate folosi comanda.");

    const loadingMsg = await message.reply("⏳ Preiau istoricul ofertelor curente pentru a preveni spam-ul...");
    
    let gCfg = await getGuildConfig(guildId);
    gCfg.discountChannelId = message.channel.id;
    gCfg.discountsSubscribed = true;
    if (!gCfg.seenDiscounts) gCfg.seenDiscounts = [];

    try {
      const currentDeals = await fetchDeals();
      for (const d of currentDeals) {
        if (!gCfg.seenDiscounts.includes(d.id)) {
          gCfg.seenDiscounts.push(d.id);
        }
      }
      // Păstrăm un număr rezonabil de deal-uri trecute pentru siguranță
      if (gCfg.seenDiscounts.length > 300) {
        gCfg.seenDiscounts = gCfg.seenDiscounts.slice(-300);
      }
    } catch (e) {
      console.warn("Nu s-au putut prelua ofertele la comanda start reduceri:", e.message);
    }

    await saveGuildConfig(guildId, gCfg);
    await loadingMsg.edit("✅ Am activat alertele pentru reduceri masive pe acest canal! Vei primi **doar** oferte noi apărute de acum înainte.");
    return;
  }

  if (command1 === "stop" && command2 === "reduceri") {
    args.shift();
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Doar un administrator poate folosi comanda.");

    await GuildModel.updateOne({ _id: guildId }, { $set: { discountsSubscribed: false } });
    return message.reply("🛑 Am oprit notificările pentru reduceri pe acest server.");
  }

  if (command1 === "latest") {
    // --- 1. LATEST REDUCERI ---
    if (command2 === "reduceri") {
      args.shift();

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

      if (isCached) {
        loadingMsg = await message.reply(`⏳ *Aduc datele instantaneu din cache...*`);
      } else {
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

        if (!rawDeals || rawDeals.length === 0) {
          return loadingMsg.edit("❌ Nu am găsit nicio ofertă activă.");
        }

        const maxDeals = rawDeals.slice(0, 50);
        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(maxDeals.length / itemsPerPage);

        const generatePageEmbeds = async (pageIndex) => {
          const startIndex = pageIndex * itemsPerPage;
          const chunk = maxDeals.slice(startIndex, startIndex + itemsPerPage);
          const enrichedChunk = await Promise.all(chunk.map(d => enrichDealData({ ...d })));

          return enrichedChunk.map(deal => {
            const isFree = parseFloat(deal.salePrice) === 0;
            const embed = new EmbedBuilder()
              .setColor(isFree ? 0x0099ff : 0x2b2d31)
              .setTitle(`${isFree ? "Free Game: " : "Reducere: "}${String(deal.title).slice(0, 200)}`)
              .setAuthor({ name: deal.store })
              .setDescription(
                `**Price:**\n~~$${deal.normalPrice}~~ ${isFree ? "FREE" : `$${deal.salePrice} (-${deal.savings}%)`}\n\n` +
                (deal.endDateStr !== "Nespecificat" ? `**${isFree ? "Free until" : "Offer ends"}:**\n${deal.endDateStr}\n\n` : "") +
                `🔗 [Accesează Magazinul](${deal.link})`
              )
              .setFooter({ text: `Pagina ${pageIndex + 1} din ${totalPages}` });

            if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
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

        const replyMsg = await loadingMsg.edit({
          content: `✅ **Top ${maxDeals.length} oferte Steam & Epic găsite:**`,
          embeds: firstPageEmbeds,
          components: [generateButtons(currentPage)]
        });

        const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

        collector.on("collect", async (btnInteraction) => {
          if (btnInteraction.user.id !== message.author.id) {
            return btnInteraction.reply({ content: "Doar cel care a cerut comanda poate schimba paginile!", ephemeral: true });
          }

          if (btnInteraction.customId === "prev_page") currentPage--;
          if (btnInteraction.customId === "next_page") currentPage++;

          await btnInteraction.deferUpdate();
          const newEmbeds = await generatePageEmbeds(currentPage);
          await btnInteraction.editReply({ embeds: newEmbeds, components: [generateButtons(currentPage)] });
        });

        collector.on("end", () => {
          replyMsg.edit({ components: [] }).catch(() => null);
        });

      } catch (error) {
        await loadingMsg.edit(`❌ Eroare la extragerea datelor: \`${error.message}\``).catch(() => null);
      }
      return;
    }

    // --- 2. LATEST UPDATES (TOATE JOCURILE) ---
    if (command2 === "updates") {
      args.shift();

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

      if (isCached) {
        loadingMsg = await message.reply(`⏳ *Aduc datele instantaneu din cache...*`);
      } else {
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
      if (validResults.length === 0) {
        return loadingMsg.edit("❌ Nu am putut prelua update-uri pentru niciun joc.");
      }

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

      const replyMsg = await loadingMsg.edit({
        content: `✅ **Cele mai recente update-uri (${validResults.length} rezultate disponibile):**`,
        embeds: currentEmbeds,
        components: [generateUpdateButtons(currentPage)]
      });

      const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

      collector.on("collect", async (btnInteraction) => {
        if (btnInteraction.user.id !== message.author.id) {
          return btnInteraction.reply({ content: "Doar utilizatorul care a apelat comanda poate folosi butoanele!", ephemeral: true });
        }

        if (btnInteraction.customId === "prev_upd") {
          await btnInteraction.deferUpdate();
          currentPage--;
          currentEmbeds = await getPageEmbeds(currentPage);
          await btnInteraction.editReply({ embeds: currentEmbeds, components: [generateUpdateButtons(currentPage)] });
        } else if (btnInteraction.customId === "next_upd") {
          await btnInteraction.deferUpdate();
          currentPage++;
          currentEmbeds = await getPageEmbeds(currentPage);
          await btnInteraction.editReply({ embeds: currentEmbeds, components: [generateUpdateButtons(currentPage)] });
        }
      });

      collector.on("end", () => {
        replyMsg.edit({ components: [] }).catch(() => null);
      });

      return;
    }

    // --- 3. LATEST UPDATE [PORECLĂ] ---
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

        if (cache.single[game.key] && Date.now() < cache.single[game.key].expiresAt) {
          latest = cache.single[game.key].data;
        } else {
          latest = await fetchGameUpdate(game);
          cache.single[game.key] = { data: latest, expiresAt: Date.now() + 180000 };

          const elapsed = Date.now() - startTime;
          executionTimes.single = Math.round((estMs + elapsed) / 2);
          await saveSystemTimes(executionTimes);
        }

        await loadingMsg.edit({ content: `✅ Cel mai recent update pentru **${game.name}**:`, embeds: [buildUpdateEmbed(game.name, latest)] }).catch(() => null);

      } catch (error) {
        await loadingMsg.edit(`❌ Nu am putut lua ultimul update pentru **${game.name}**.`);
      }

      return;
    }

    return message.reply(`❌ Comandă incorectă. Folosește \`${PREFIX}help\` pentru a vedea cum se folosesc comenzile noi.`);
  }

  // --- MENIUL HELP DETAILIAT ---
  if (command1 === "help") {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle("📚 Manualul Botului - Meniul de Ajutor")
      .setDescription("Iată lista completă a comenzilor și explicația exactă a ceea ce face fiecare:")
      .addFields(
        {
          name: `${PREFIX}start updates`, value: "Dacă scrii comanda asta pe un canal, botul va trimite automat mesaje doar pe acest canal de fiecare dată când apare un update oficial nou pentru oricare din jocurile urmărite."
        }, {
          name: `${PREFIX}stop updates`, value: "Oprește imediat trimiterea automată a notificărilor de update-uri pentru tot serverul."
        }, {
          name: `${PREFIX}start reduceri`, value: "Setează canalul curent ca destinație pentru alertele cu reduceri masive de preț (peste 70%) sau jocuri complet gratuite de pe platformele Steam și Epic Games."
        }, {
          name: `${PREFIX}stop reduceri`, value: "Oprește alertele automate de oferte și jocuri gratuite pe acest server."
        }, {
          name: `${PREFIX}latest updates`, value: "Afișează pe loc, manual, o listă structurată pe pagini cu cele mai noi update-uri pentru toate jocurile pe care le monitorizează botul."
        }, {
          name: `${PREFIX}latest update [poreclă]`, value: `Caută imediat cel mai recent update pentru un anumit joc. De exemplu, scrii \`${PREFIX}latest update cs2\` și primești ultimul update la Counter-Strike 2.`
        }, {
          name: `${PREFIX}latest reduceri`, value: "Caută manual și afișează topul ofertelor și jocurilor gratuite valabile în acest moment pe Steam și Epic Games."
        }, {
          name: `${PREFIX}games`, value: "Îți arată pur și simplu o listă curată cu numele tuturor jocurilor și driverelor incluse momentan în baza mea de date."
        }, {
          name: `${PREFIX}porecle`, value: `Îți arată cuvintele cheie (poreclele) pe care trebuie să le folosești alături de comanda \`latest update\` pentru a găsi rapid jocul dorit.`
        }, {
          name: `${PREFIX}ping`, value: "Testează rapid dacă sunt online și îți arată că sistemele mele sunt operaționale."
        }
      )
      .setFooter({ text: "Pentru orice eroare, contactează administratorul." })
      .setTimestamp();

    await message.reply({ embeds: [helpEmbed] });
    return;
  }
});

// -------------------------------------------------------------
// BOOTSTRAP - PORNIRE SECURIZATĂ
// -------------------------------------------------------------
async function bootstrap() {
  if (!process.env.MONGO_URI) {
    console.error("❌ CRITIC: Lipsește variabila de mediu MONGO_URI!");
    process.exit(1);
  }
  if (!process.env.DISCORD_TOKEN) {
    console.error("❌ CRITIC: Lipsește variabila de mediu DISCORD_TOKEN!");
    process.exit(1);
  }

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
