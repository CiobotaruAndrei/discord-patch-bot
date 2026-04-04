const fs = require("fs");
const path = require("path");
const axios = require("axios");
const translate = require("translate-google");
const mongoose = require("mongoose");
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

const CONFIG_PATH = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

// -------------------------------------------------------------
// CONEXIUNE ȘI SCHEMA MONGODB PENTRU STARE PERSISTENTĂ
// -------------------------------------------------------------

if (!process.env.MONGO_URI) {
  console.error("❌ CRITIC: Lipsește variabila de mediu MONGO_URI!");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectat cu succes la baza de date MongoDB!"))
  .catch((err) => console.error("❌ Eroare critică la conectarea MongoDB:", err));

const stateSchema = new mongoose.Schema({
  _id: { type: String, default: "global_state" },
  guilds: { type: Object, default: {} },
  seen: { type: Object, default: {} },
  seenDiscounts: { type: Array, default: [] },
  executionTimes: { 
    type: Object, 
    default: { all: 15000, single: 2000, reduceri: 15000 } 
  }
}, { minimize: false });

const StateModel = mongoose.model("State", stateSchema);

async function loadState() {
  let state = await StateModel.findById("global_state").lean();
  if (!state) {
    state = {
      _id: "global_state",
      guilds: {},
      seen: {},
      seenDiscounts: [],
      executionTimes: { all: 15000, single: 2000, reduceri: 15000 }
    };
    await StateModel.create(state);
  }
  
  if (!state.guilds) state.guilds = {};
  if (!state.seen) state.seen = {};
  if (!state.seenDiscounts) state.seenDiscounts = [];
  if (!state.executionTimes) state.executionTimes = { all: 15000, single: 2000, reduceri: 15000 };
  
  return state;
}

async function saveState(stateObj) {
  await StateModel.findByIdAndUpdate("global_state", stateObj, { upsert: true });
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

// -------------------------------------------------------------
// FUNCȚII PENTRU DRIVERE 
// -------------------------------------------------------------

async function fetchNvidiaUpdate(game) {
  const exactQuery = game.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const searchQuery = `site:nvidia.com ${exactQuery} release`;

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await axios.get(rssUrl, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
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
      id: cleanT, title: `${game.name} ${versionStr}`, link: link, 
      excerpt: `Sursa: Sistemul oficial de articole NVIDIA.`, thumbnail: game.thumbnail, timestamp: new Date(pubDate).toISOString()
    };
  }
  throw new Error(`Nu am putut găsi date pentru ${game.name}.`);
}

async function fetchIntelUpdate(game) {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(game.url)}`;
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    const html = String(res?.data?.contents || "");
    const versionMatch = html.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    
    if (versionMatch) {
      const version = versionMatch[1];
      return {
        id: version, title: `${game.name} v${version}`, link: game.url,
        excerpt: `Extras direct de pe pagina oficială Intel.\n**Versiune găsită:** ${version}`, thumbnail: game.thumbnail, timestamp: new Date().toISOString()
      };
    }
  } catch (err) {}

  const searchQuery = game.key === "intelpro" ? "site:intel.com \"Intel Arc Pro Graphics\"" : "site:intel.com \"Intel Arc & Iris Xe Graphics - Windows\"";
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const fallbackRes = await axios.get(rssUrl, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
  const xml = String(fallbackRes.data || "");
  const match = xml.match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/i);
  
  if (match) {
    const rawTitle = cleanText(match[1]);
    const cleanT = rawTitle.split(" - ")[0];
    const vMatch = cleanT.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    const versionStr = vMatch ? `v${vMatch[1]}` : "Update Nou";

    return {
      id: cleanText(match[1]), title: `${game.name} ${versionStr}`, link: match[2],
      excerpt: "Sursa: Sistemul oficial de articole Intel.", thumbnail: game.thumbnail, timestamp: new Date().toISOString()
    };
  }
  throw new Error("Acces refuzat la serverele Intel.");
}

async function fetchAmdUpdate(game) {
  const amdUrl = "https://www.amd.com/en/support/download/drivers.html";
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(amdUrl)}`;
  
  try {
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    const html = String(res?.data?.contents || "");
    const versionMatch = html.match(/Adrenalin Edition\s+([\d\.]+)/i);
    
    if (versionMatch) {
      return {
        id: versionMatch[1], title: `AMD Radeon Adrenalin v${versionMatch[1]}`, link: amdUrl,
        excerpt: "Scanat direct de pe serverul amd.com. Un nou driver este disponibil.", thumbnail: game.thumbnail, timestamp: new Date().toISOString()
      };
    }
  } catch (err) {}

  const rssUrl = `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US&gl=US&ceid=US:en`;
  const fallbackRes = await axios.get(rssUrl, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" }});
  const match = String(fallbackRes.data).match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/i);
  
  if (match) {
    return {
      id: cleanText(match[1]), title: cleanText(match[1]).split(" - ")[0], link: match[2],
      excerpt: "Sursa: Sistemul oficial de articole AMD.", thumbnail: game.thumbnail, timestamp: new Date().toISOString()
    };
  }
  throw new Error("Acces refuzat de protecția anti-bot a serverului AMD.");
}

// -------------------------------------------------------------
// FUNCȚIILE DE JOCURI 
// -------------------------------------------------------------

async function fetchSteamUpdate(game) {
  const apiUrl = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=100&maxlength=2000&format=json`;
  const response = await axios.get(apiUrl, { timeout: 15000 });
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

  let rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[[^\]]+\]/g, " ");
  const cleanExcerpt = cleanText(rawContents).slice(0, 700);

  return {
    id: String(latest.gid), title: cleanText(latest.title), link: String(latest.url).trim(), 
    excerpt: cleanExcerpt || `A apărut un nou update pentru ${game.name}.`, timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : undefined
  };
}

function parseAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) anchors.push({ href: absoluteUrl(baseUrl, match[1]), text: cleanText(match[2]) });
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

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length ? game.listingUrls : [game.listingUrl];
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;
  let collected = [];

  for (const url of listingUrls) {
    const listRes = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
    });
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
  if (keywords.length) collected.sort((a, b) => scoreCandidate(b, keywords) - scoreCandidate(a, keywords));
  if (!collected.length) throw new Error(`Nu am găsit articole de update pentru ${game.name}.`);

  const articleUrl = collected[0].href;
  const articleRes = await axios.get(articleUrl, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
  const articleHtml = String(articleRes.data || "");

  return {
    id: String(articleUrl), title: extractTitleFromHtml(articleHtml) || `Update nou pentru ${game.name}`, link: articleUrl,
    excerpt: extractDescriptionFromHtml(articleHtml).slice(0, 700) || `A apărut un nou update oficial pentru ${game.name}.`,
    image: extractImageFromHtml(articleHtml), thumbnail: game.thumbnail || undefined, timestamp: extractPublishedTimeFromHtml(articleHtml)
  };
}

async function fetchMinecraftUpdate() {
  const manifestRes = await axios.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", { timeout: 15000 });
  const latestVersion = manifestRes?.data?.latest?.release;
  if (!latestVersion) throw new Error("Date lipsă pe serverul Mojang.");
  const formattedVersion = latestVersion.replace(/\./g, "-");

  return {
    id: String(latestVersion), title: `Minecraft: Java Edition ${latestVersion}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${formattedVersion}`,
    excerpt: `O nouă versiune oficială (${latestVersion}) este disponibilă!`,
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
    const res = await axios.get(proxyUrl, { timeout: 20000 });
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

    return {
      id: String(latest._id || latest.slug), title: cleanText(latest.title) || "Fortnite Update", link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: cleanText(latest.shareDescription || "A apărut o nouă actualizare oficială.").slice(0, 700),
      image: latest.image || latest.trendingImage, thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date ? new Date(latest.date).toISOString() : new Date().toISOString()
    };
  } catch (error) {
    const backupUrl = "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Dsite%3Afortnite.com%2Fnews%2Bupdate%26hl%3Den-US%26gl%3DUS%26ceid%3DUS%3Aen";
    const fallbackRes = await axios.get(backupUrl, { timeout: 15000 });
    const items = fallbackRes?.data?.items;
    if (!Array.isArray(items) || items.length === 0) throw new Error("Toate metodele pentru Fortnite au eșuat.");

    const latestBackup = items[0];
    return {
      id: String(latestBackup.guid || latestBackup.link), title: cleanText(latestBackup.title).replace(/\s-\sFortnite$/i, "").trim() || "Fortnite: Noutăți",
      link: latestBackup.link || "https://www.fortnite.com/news", excerpt: "A apărut un nou articol oficial de actualizare pe site-ul Fortnite.",
      image: "https://cdn2.unrealengine.com/14br-consoles-1920x1080-1920x1080-4954ecbc82b3.jpg", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latestBackup.pubDate ? new Date(latestBackup.pubDate).toISOString() : new Date().toISOString()
    };
  }
}

async function fetchRobloxUpdate() {
  const res = await axios.get("https://clientsettings.roblox.com/v2/client-version/WindowsPlayer", { timeout: 15000 });
  const version = res?.data?.clientVersionUpload;
  if (!version) throw new Error("Nu am putut accesa serverul de update Roblox.");

  return {
    id: String(version), title: "Roblox Client Update", link: "https://en.help.roblox.com/hc/en-us/articles/203312870-Update-Log",
    excerpt: `Un nou client oficial Roblox a fost urcat pe servere (versiunea: ${version}).`,
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg", timestamp: new Date().toISOString()
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
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    if (res?.data?.contents) deals = JSON.parse(res.data.contents);
  } catch (err) {}

  if (!Array.isArray(deals) || deals.length === 0) {
    try {
      const proxyUrl2 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
      const res2 = await axios.get(proxyUrl2, { timeout: 15000 });
      if (Array.isArray(res2.data)) deals = res2.data;
    } catch (err) {}
  }

  if (!Array.isArray(deals) || deals.length === 0) {
    try {
      const res3 = await axios.get(targetUrl, {
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
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
    id: d.dealID, steamAppID: d.steamAppID,
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

  const finalTop50 = [...epicDeals, ...steamDeals];
  if (finalTop50.length === 0) throw new Error("Nu s-au putut extrage oferte valide de pe Steam sau Epic.");
  
  return finalTop50;
}

async function enrichDealData(deal) {
  deal.endDateStr = "Nespecificat";
  deal.extraDetails = "";

  if (deal.store === "Steam" && deal.steamAppID) {
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}`;
      const res = await axios.get(url, { timeout: 5000 });
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
      
      const htmlRes = await axios.get(deal.link, {
        timeout: 5000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Cookie": "strLanguage=english; birthtime=283993201; mature_content=1;" 
        }
      });
      const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
      if (match && match[1]) {
        deal.endDateStr = match[1].trim();
      }
    } catch (e) { }
  } 
  else if (deal.store === "Epic Games") {
    try {
      let cleanTitle = deal.title.replace(/(Standard|Deluxe|Ultimate|Edition)/gi, "").trim();
      if (cleanTitle.split(' ').length > 4) {
         cleanTitle = cleanTitle.split(' ').slice(0, 4).join(' ');
      }

      const epicQuery = {
        query: `query searchStoreQuery($keywords: String!) { Catalog { searchStore(keywords: $keywords, count: 3, country: "US", locale: "en-US") { elements { title price(country: "US") { lineOffers { appliedRules { endDate } } } promotions { promotionalOffers { promotionalOffers { endDate } } } } } } }`,
        variables: { keywords: cleanTitle }
      };

      const response = await axios.post('https://graphql.epicgames.com/graphql', epicQuery, {
        timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
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
            const hr = d.getHours().toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
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
// DISPECERUL PRINCIPAL & MULTI-SERVER LOGIC
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function sendUpdateToAllSubscribedGuilds(gameName, latest) {
  const state = await loadState();
  const embed = buildUpdateEmbed(gameName, latest);
  
  const translateBtn = new ButtonBuilder()
    .setCustomId("translate_update")
    .setLabel("🇷🇴 Tradu în Română")
    .setStyle(ButtonStyle.Primary)
    .setEmoji("🌍");
    
  const row = new ActionRowBuilder().addComponents(translateBtn);

  for (const [guildId, guildConfig] of Object.entries(state.guilds)) {
    if (guildConfig.subscribed && guildConfig.notificationChannelId) {
      try {
        const channel = await client.channels.fetch(guildConfig.notificationChannelId);
        if (channel) {
          await channel.send({ embeds: [embed], components: [row] });
        }
      } catch (err) {
        console.error(`Nu am putut trimite pe serverul ${guildId}`, err);
      }
    }
  }
}

async function initializeSeenForCurrentGames() {
  const state = await loadState();
  for (const game of config.games) {
    try {
      const latest = await fetchGameUpdate(game);
      state.seen[game.key] = latest.id;
    } catch (error) {
      console.error(`Nu am putut inițializa ${game.name}: ${error.message}`);
    }
  }
  await saveState(state);
}

async function checkForUpdates() {
  const state = await loadState();
  
  const hasSubscribers = Object.values(state.guilds).some(g => g.subscribed && g.notificationChannelId);
  if (!hasSubscribers) return false;

  let foundSomething = false;
  for (const game of config.games) {
    try {
      const latest = await fetchGameUpdate(game);
      const previousId = state.seen[game.key];

      if (previousId !== latest.id) {
        state.seen[game.key] = latest.id;
        await saveState(state);
        if (previousId) {
          await sendUpdateToAllSubscribedGuilds(game.name, latest);
          foundSomething = true;
        }
      }
    } catch (error) {
      console.error(`Eroare la ${game.name}: ${error.message}`);
    }
  }
  return foundSomething;
}

async function checkForDiscounts() {
  const state = await loadState();
  const hasDiscountSubscribers = Object.values(state.guilds).some(g => g.discountsSubscribed && g.discountChannelId);
  if (!hasDiscountSubscribers) return;

  try {
    const deals = await fetchDeals();
    let newDealsFound = false;

    for (const deal of deals) {
      if (!state.seenDiscounts.includes(deal.id)) {
        state.seenDiscounts.push(deal.id);
        newDealsFound = true;

        const isFree = parseFloat(deal.salePrice) === 0;
        const embed = new EmbedBuilder()
          .setColor(isFree ? 0xffd700 : 0xe74c3c)
          .setTitle(String(`${isFree ? "Free Game: " : "Reducere: "}${deal.title}`).slice(0, 250))
          .setDescription(
            `**${deal.store}** oferă o reducere masivă de **${deal.savings}%**!\n\n` +
            (deal.endDateStr !== "Nespecificat" ? `⏳ **${isFree ? "Free until" : "Offer ends"}:** ${deal.endDateStr}\n\n` : "")
          )
          .addFields(
            { name: 'Preț Vechi', value: `~~$${deal.normalPrice}~~`, inline: true },
            { name: 'Preț Nou', value: isFree ? "🔥 GRATIS 🔥" : `$${deal.salePrice}`, inline: true },
            { name: 'Link Către Magazin', value: `[Apasă aici pentru ofertă](${deal.link})`, inline: false }
          )
          .setTimestamp();
          
        if (deal.thumbnail && deal.thumbnail.startsWith("http")) {
            embed.setThumbnail(deal.thumbnail);
        }

        for (const [guildId, guildConfig] of Object.entries(state.guilds)) {
          if (guildConfig.discountsSubscribed && guildConfig.discountChannelId) {
            try {
              const channel = await client.channels.fetch(guildConfig.discountChannelId);
              if (channel) await channel.send({ embeds: [embed] });
            } catch (err) {}
          }
        }
      }
    }

    if (newDealsFound) {
      if (state.seenDiscounts.length > 300) state.seenDiscounts = state.seenDiscounts.slice(-300);
      await saveState(state);
    }
  } catch (error) {
    console.error("Eroare la căutarea reducerilor:", error.message);
  }
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
// EVENT HANDLERS
// -------------------------------------------------------------

client.once("ready", async () => {
  console.log("🤖 Botul este online și așteaptă comenzi.");
  console.log(`Conectat ca: ${client.user.tag}`);

  setInterval(async () => {
    try {
      await checkForUpdates();
      await checkForDiscounts();
    } catch (error) {
      console.error("Eroare în Loop-ul principal:", error);
    }
  }, Number(config.checkIntervalMinutes || 30) * 60 * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "translate_update") {
    await interaction.deferUpdate();
    
    const originalEmbed = interaction.message.embeds[0];
    if (!originalEmbed || !originalEmbed.description) return;

    try {
      const translatedDesc = await translate(originalEmbed.description, { to: 'ro' });
      let translatedTitle = originalEmbed.title;
      if (originalEmbed.title) {
        translatedTitle = await translate(originalEmbed.title, { to: 'ro' });
      }

      const newEmbed = EmbedBuilder.from(originalEmbed)
        .setTitle(translatedTitle)
        .setDescription(translatedDesc);

      await interaction.editReply({ embeds: [newEmbed], components: [] });
    } catch (error) {
      console.error("Eroare la traducere:", error);
      await interaction.followUp({ content: "❌ A apărut o eroare la conexiunea cu serverul de traducere.", ephemeral: true });
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const PREFIX = "big_master!";
  if (!message.content.startsWith(PREFIX)) return;

  // Împărțim mesajul în bucăți
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command1 = (args.shift() || "").toLowerCase(); // Primul cuvânt (ex: start, stop, latest)
  const command2 = (args[0] || "").toLowerCase();      // Al doilea cuvânt (ex: updates, reduceri, update)

  const guildId = message.guild.id;

  if (command1 === "ping") {
    await message.reply("Pong! 🏓 Sistemele sunt operaționale.");
    return;
  }

  if (command1 === "games") {
    await message.reply(
      `🎮 **Jocuri urmărite:**\n${config.games.map((g) => `- **${g.name}**`).join("\n")}`
    );
    return;
  }

  if (command1 === "porecle") {
    const list = config.games.map((g) => `**${g.name}** -> folosește porecla: \`${g.key}\``).join("\n");
    await message.reply(
      `🏷️ **Lista de porecle pentru jocuri:**\nPentru a vedea ultimul update al unui joc specific, folosește comanda \`${PREFIX}latest update [poreclă]\`.\n\n${list}`
    );
    return;
  }

  if (command1 === "start" && command2 === "updates") {
    args.shift(); // Scoatem "updates" din ecuație
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`⛔ Doar un administrator poate folosi comanda.`);
    }
    const state = await loadState();
    if (!state.guilds[guildId]) state.guilds[guildId] = {};
    
    state.guilds[guildId].notificationChannelId = message.channel.id;
    state.guilds[guildId].subscribed = true;
    await saveState(state);
    await initializeSeenForCurrentGames();
    return message.reply("✅ Am pornit notificările automate de update-uri pe acest canal pentru acest server.");
  }

  if (command1 === "stop" && command2 === "updates") {
    args.shift(); // Scoatem "updates"
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`⛔ Doar un administrator poate folosi comanda.`);
    }
    const state = await loadState();
    if (state.guilds[guildId]) {
      state.guilds[guildId].subscribed = false;
      await saveState(state);
    }
    return message.reply("🛑 Am oprit notificările automate de update pentru acest server.");
  }

  if (command1 === "start" && command2 === "reduceri") {
    args.shift(); // Scoatem "reduceri"
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`⛔ Doar un administrator poate folosi comanda.`);
    }
    const state = await loadState();
    if (!state.guilds[guildId]) state.guilds[guildId] = {};
    
    state.guilds[guildId].discountChannelId = message.channel.id;
    state.guilds[guildId].discountsSubscribed = true;
    await saveState(state);
    await message.reply("✅ Am activat alertele pentru reduceri masive pe acest canal!");
    await checkForDiscounts();
    return;
  }

  if (command1 === "stop" && command2 === "reduceri") {
    args.shift(); // Scoatem "reduceri"
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`⛔ Doar un administrator poate folosi comanda.`);
    }
    const state = await loadState();
    if (state.guilds[guildId]) {
      state.guilds[guildId].discountsSubscribed = false;
      await saveState(state);
    }
    return message.reply("🛑 Am oprit notificările pentru reduceri pe acest server.");
  }

  if (command1 === "latest") {
    // --- 1. LATEST REDUCERI ---
    if (command2 === "reduceri") {
      args.shift(); // Scoatem "reduceri"
      const state = await loadState();
      const estMs = state.executionTimes?.reduceri || 15000; 
      const estSec = Math.max(1, Math.ceil(estMs / 1000));

      const loadingMsg = await message.reply(`⏳ *Caut și procesez ofertele disponibile... Durată estimată: **${estSec} secunde**.*`);
      const startTime = Date.now();

      try {
        const rawDeals = await fetchDeals(); 
        if (!rawDeals || rawDeals.length === 0) {
          return loadingMsg.edit(`❌ Nu am găsit nicio ofertă activă.`);
        }

        const maxDeals = rawDeals.slice(0, 50); 
        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(maxDeals.length / itemsPerPage);

        const generatePageEmbeds = async (pageIndex) => {
          const startIndex = pageIndex * itemsPerPage;
          const chunk = maxDeals.slice(startIndex, startIndex + itemsPerPage);
          const enrichedChunk = await Promise.all(chunk.map(enrichDealData));
          
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
            new ButtonBuilder().setCustomId('prev_page').setLabel('◀ Pagina Anterioară').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
            new ButtonBuilder().setCustomId('next_page').setLabel('Următoarea Pagină ▶').setStyle(ButtonStyle.Primary).setDisabled(pageIndex === totalPages - 1)
          );
        };

        const firstPageEmbeds = await generatePageEmbeds(currentPage);

        const elapsed = Date.now() - startTime;
        state.executionTimes["reduceri"] = Math.round((estMs + elapsed) / 2);
        await saveState(state);

        const replyMsg = await loadingMsg.edit({ content: `✅ **Top ${maxDeals.length} oferte Epic & Steam găsite:**`, embeds: firstPageEmbeds, components: [generateButtons(currentPage)] });

        const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 }); 

        collector.on('collect', async (btnInteraction) => {
          if (btnInteraction.user.id !== message.author.id) {
            return btnInteraction.reply({ content: 'Doar cel care a cerut comanda poate schimba paginile!', ephemeral: true });
          }

          if (btnInteraction.customId === 'prev_page') currentPage--;
          if (btnInteraction.customId === 'next_page') currentPage++;

          await btnInteraction.deferUpdate();
          const newEmbeds = await generatePageEmbeds(currentPage);
          await btnInteraction.editReply({ embeds: newEmbeds, components: [generateButtons(currentPage)] });
        });

        collector.on('end', () => {
          replyMsg.edit({ components: [] }).catch(() => null);
        });

      } catch (error) {
        await loadingMsg.edit(`❌ Eroare la extragerea datelor: \`${error.message}\``).catch(() => null);
      }
      return; 
    }

    // --- 2. LATEST UPDATES (TOATE JOCURILE) ---
    if (command2 === "updates") {
      args.shift(); // Scoatem "updates"
      const state = await loadState();
      const estMs = state.executionTimes?.all || 15000;
      const estSec = Math.max(1, Math.ceil(estMs / 1000)); 

      const loadingMsg = await message.reply(`⏳ *Mă conectez la servere... Durată estimată: **${estSec} secunde**.*`);
      const startTime = Date.now(); 

      const results = await getLatestForAllGames();
      const elapsed = Date.now() - startTime;
      state.executionTimes["all"] = Math.round((estMs + elapsed) / 2);
      await saveState(state);
      
      const validResults = results.filter(r => r.latest !== null);
      if (validResults.length === 0) {
         return loadingMsg.edit(`❌ Nu am putut prelua update-uri pentru niciun joc.`);
      }

      let currentPage = 0;
      const itemsPerPage = 5; 
      const totalPages = Math.ceil(validResults.length / itemsPerPage);

      const generateUpdateEmbeds = (pageIndex) => {
        const startIndex = pageIndex * itemsPerPage;
        const chunk = validResults.slice(startIndex, startIndex + itemsPerPage);
        return chunk.map(r => {
           const embed = buildUpdateEmbed(r.game.name, r.latest);
           embed.setFooter({ text: `${r.game.name} • Pagina ${pageIndex + 1} din ${totalPages}` });
           return embed;
        });
      };

      const generateUpdateButtons = (pageIndex, translated = false) => {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('prev_upd').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
          new ButtonBuilder().setCustomId('next_upd').setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(pageIndex === totalPages - 1)
        );
        if (!translated) {
          row.addComponents(
            new ButtonBuilder().setCustomId('trans_upd').setLabel('🇷🇴 Tradu Pagina').setStyle(ButtonStyle.Success).setEmoji("🌍")
          );
        }
        return row;
      };

      let currentEmbeds = generateUpdateEmbeds(currentPage);
      let isTranslatedPage = false;

      const replyMsg = await loadingMsg.edit({
        content: `✅ **Cele mai recente update-uri (${validResults.length} jocuri monitorizate):**`,
        embeds: currentEmbeds,
        components: [generateUpdateButtons(currentPage, isTranslatedPage)]
      });

      const collector = replyMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

      collector.on('collect', async (btnInteraction) => {
        if (btnInteraction.user.id !== message.author.id) {
          return btnInteraction.reply({ content: 'Doar utilizatorul care a apelat comanda poate folosi butoanele!', ephemeral: true });
        }

        if (btnInteraction.customId === 'prev_upd') {
          currentPage--;
          isTranslatedPage = false; 
          currentEmbeds = generateUpdateEmbeds(currentPage);
          await btnInteraction.deferUpdate();
          await btnInteraction.editReply({ embeds: currentEmbeds, components: [generateUpdateButtons(currentPage, isTranslatedPage)] });
        } 
        else if (btnInteraction.customId === 'next_upd') {
          currentPage++;
          isTranslatedPage = false;
          currentEmbeds = generateUpdateEmbeds(currentPage);
          await btnInteraction.deferUpdate();
          await btnInteraction.editReply({ embeds: currentEmbeds, components: [generateUpdateButtons(currentPage, isTranslatedPage)] });
        }
        else if (btnInteraction.customId === 'trans_upd') {
          await btnInteraction.deferUpdate();
          isTranslatedPage = true;
          
          const msgEmbeds = btnInteraction.message.embeds;
          const translatedEmbeds = [];
          
          for (const emb of msgEmbeds) {
            try {
              let tDesc = emb.description ? await translate(emb.description, { to: 'ro' }) : emb.description;
              let tTitle = emb.title ? await translate(emb.title, { to: 'ro' }) : emb.title;
              translatedEmbeds.push(EmbedBuilder.from(emb).setTitle(tTitle).setDescription(tDesc));
            } catch (err) {
              translatedEmbeds.push(EmbedBuilder.from(emb)); 
            }
          }
          currentEmbeds = translatedEmbeds;
          await btnInteraction.editReply({ embeds: currentEmbeds, components: [generateUpdateButtons(currentPage, isTranslatedPage)] });
        }
      });

      collector.on('end', () => {
        replyMsg.edit({ components: [] }).catch(() => null);
      });

      return;
    }

    // --- 3. LATEST UPDATE [PORECLĂ] (JOC SPECIFIC) ---
    if (command2 === "update") {
      args.shift(); // Scoatem "update"
      
      const gameText = args.join(" "); // Tot ce ramane e porecla
      const state = await loadState();
      const estMs = state.executionTimes?.single || 2000;
      const estSec = Math.max(1, Math.ceil(estMs / 1000)); 

      const loadingMsg = await message.reply(`⏳ *Mă conectez la servere... Durată estimată: **${estSec} secunde**.*`);
      const startTime = Date.now(); 

      const game = findGameFromText(gameText);
      if (!game) return loadingMsg.edit(`❌ Nu am găsit jocul. Folosește **${PREFIX}porecle** pentru a vedea lista exactă.`);

      try {
        const latest = await fetchGameUpdate(game);
        const elapsed = Date.now() - startTime;
        state.executionTimes["single"] = Math.round((estMs + elapsed) / 2);
        await saveState(state);
        await loadingMsg.delete().catch(() => null);

        const translateBtnRowSingle = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("translate_update").setLabel("🇷🇴 Tradu în Română").setStyle(ButtonStyle.Primary).setEmoji("🌍")
        );

        await message.channel.send({ embeds: [buildUpdateEmbed(game.name, latest)], components: [translateBtnRowSingle] });
      } catch (error) {
        await loadingMsg.edit(`❌ Nu am putut lua ultimul update pentru **${game.name}**.`);
      }
      return;
    }

    // Dacă ajunge aici înseamnă că a scris "big_master!latest" dar fără argumentele corecte
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
          name: `\`${PREFIX}start updates\``, 
          value: "Dacă scrii comanda asta pe un canal, botul va trimite automat mesaje **doar pe acest canal** de fiecare dată când apare un update oficial nou pentru oricare din jocurile urmărite." 
        },
        { 
          name: `\`${PREFIX}stop updates\``, 
          value: "Oprește imediat trimiterea automată a notificărilor de update-uri pentru tot serverul." 
        },
        { 
          name: `\`${PREFIX}start reduceri\``, 
          value: "Setează canalul curent ca destinație pentru alertele cu reduceri masive de preț (peste 70%) sau jocuri complet gratuite de pe platformele Steam și Epic Games." 
        },
        { 
          name: `\`${PREFIX}stop reduceri\``, 
          value: "Oprește alertele automate de oferte și jocuri gratuite pe acest server." 
        },
        { 
          name: `\`${PREFIX}latest updates\``, 
          value: "Afișează pe loc, manual, o listă structurată pe pagini cu cele mai noi update-uri pentru **toate jocurile** pe care le monitorizează botul." 
        },
        { 
          name: `\`${PREFIX}latest update [poreclă]\``, 
          value: "Caută imediat cel mai recent update pentru un anumit joc. De exemplu, scrii `big_master!latest update cs2` și primești ultimul update la Counter-Strike 2." 
        },
        { 
          name: `\`${PREFIX}latest reduceri\``, 
          value: "Caută manual și afișează topul ofertelor și jocurilor gratuite valabile în acest moment pe Epic Games și Steam." 
        },
        { 
          name: `\`${PREFIX}games\``, 
          value: "Îți arată pur și simplu o listă curată cu numele tuturor jocurilor și driverelor incluse momentan în baza mea de date." 
        },
        { 
          name: `\`${PREFIX}porecle\``, 
          value: "Îți arată cuvintele cheie (poreclele) pe care trebuie să le folosești alături de comanda `latest update` pentru a găsi rapid jocul dorit." 
        },
        { 
          name: `\`${PREFIX}ping\``, 
          value: "Testează rapid dacă sunt online și îți arată că sistemele mele sunt operaționale." 
        }
      )
      .setFooter({ text: "Pentru orice eroare, contactează administratorul." })
      .setTimestamp();

    await message.reply({ embeds: [helpEmbed] });
    return;
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error);
});
