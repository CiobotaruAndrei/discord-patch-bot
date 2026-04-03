const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

const CONFIG_PATH = path.join(__dirname, "config.json");
const STATE_PATH = path.join(__dirname, "state.json");

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

function ensureStateFile() {
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify(
        {
          notificationChannelId: "",
          seen: {},
          subscribed: false,
          executionTimes: { all: 15000, single: 2000 },
          discountChannelId: "",
          seenDiscounts: [],
          discountsSubscribed: false
        },
        null,
        2
      ),
      "utf8"
    );
  } else {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      let changed = false;
      
      if (!data.executionTimes) {
        data.executionTimes = { all: 15000, single: 2000 };
        changed = true;
      }
      if (!data.seenDiscounts) {
        data.seenDiscounts = [];
        changed = true;
      }
      if (data.discountsSubscribed === undefined) {
        data.discountsSubscribed = false;
        changed = true;
      }
      if (data.discountChannelId === undefined) {
        data.discountChannelId = "";
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2), "utf8");
      }
    } catch (e) {
      console.error("Eroare la citirea state.json", e);
    }
  }
}

function loadState() {
  ensureStateFile();
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

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
  if (titleMatch) {
    return cleanText(decodeHtmlEntities(titleMatch[1]));
  }
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

function formatUpdateMessage(gameName, latest) {
  return (
    `🚨 **Update nou de instalat pentru ${gameName}**\n` +
    `📰 **${latest.title}**\n` +
    `📝 ${latest.excerpt}\n` +
    (latest.link ? `🔗 ${latest.link}` : "")
  );
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
// FUNCȚII NOI PENTRU REDUCERI - EXTRAGERE PE PLATFORME
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

// =====================================================================
// FUNCȚIA enrichDealData - VARIANTĂ 100% PRECISĂ PENTRU EPIC GAMES
// Se bazează pe MATCH EXACT DE PREȚ, ignorând confuzia cu DLC-urile
// =====================================================================
async function enrichDealData(deal) {
  deal.endDateStr = "Nespecificat";
  deal.extraDetails = "";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
    // Transformăm prețul redus ($4.99) în cenți (499) pentru a găsi exact aceeași ediție
    const targetPriceCents = Math.round(parseFloat(deal.salePrice) * 100);
    
    // Curățăm titlul de caractere dubioase, dar păstrăm restul
    let cleanTitle = deal.title.replace(/[:\-–—]/g, " ").replace(/[^a-zA-Z0-9\s]/g, "").trim();
    
    // Dacă jocul e un DLC lung gen "Suicide Squad Kill the Justice League Digital Deluxe",
    // căutarea după titlul complet poate eșua, așa că testăm și cu doar primele 3 cuvinte.
    const searchVariants = [
       cleanTitle,
       cleanTitle.split(/\s+/).slice(0, 3).join(" ")
    ];

    for (const keyword of searchVariants) {
        // Dacă am găsit deja data, ieșim din loop
        if (!keyword || deal.endDateStr !== "Nespecificat") break;
        
        const epicQuery = {
            query: `query searchStoreQuery($keywords: String!) {
              Catalog {
                searchStore(keyword: $keywords, count: 10) {
                  elements {
                    title
                    price(country: "US") {
                      totalPrice { discountPrice originalPrice }
                      lineOffers { appliedRules { endDate } }
                    }
                    promotions {
                      promotionalOffers { promotionalOffers { endDate } }
                    }
                  }
                }
              }
            }`,
            variables: { keywords: keyword }
        };

        try {
            const epicRes = await axios.post('https://graphql.epicgames.com/graphql', epicQuery, {
                timeout: 8000,
                headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            });

            const elements = epicRes.data?.data?.Catalog?.searchStore?.elements;
            
            if (Array.isArray(elements)) {
                for (const el of elements) {
                    const elPriceCents = el.price?.totalPrice?.discountPrice || 0;
                    
                    // Condiție 1: Prețul este EXACT la fel cu cel extras de Cheapshark (toleranță mică de 2 cenți rotunjire)
                    const matchPrice = Math.abs(elPriceCents - targetPriceCents) <= 2; 
                    
                    // Condiție 2: Titlul este destul de asemănător
                    const dealTitleLower = deal.title.toLowerCase().replace(/[^a-z0-9]/g, "");
                    const elTitleLower = (el.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                    const matchTitle = elTitleLower.includes(dealTitleLower) || dealTitleLower.includes(elTitleLower);

                    // Dacă am găsit jocul/ediția corectă, extragem data din reducerile lui
                    if (matchPrice || matchTitle) {
                        let foundDate = null;
                        
                        // 1. Căutăm data din reduceri normale de preț
                        const rules = el.price?.lineOffers?.[0]?.appliedRules;
                        if (Array.isArray(rules)) {
                            for (const rule of rules) {
                                if (rule.endDate) foundDate = rule.endDate;
                            }
                        }

                        // 2. Căutăm data din reduceri tip Free Game (100% off)
                        if (!foundDate) {
                            const promoOffers = el.promotions?.promotionalOffers;
                            if (Array.isArray(promoOffers)) {
                                for (const p of promoOffers) {
                                    if (Array.isArray(p.promotionalOffers)) {
                                        for (const i of p.promotionalOffers) {
                                            if (i.endDate) foundDate = i.endDate;
                                        }
                                    }
                                }
                            }
                        }

                        // Am extras o dată validă din viitor
                        if (foundDate) {
                            const d = new Date(foundDate);
                            if (!isNaN(d.getTime()) && d.getTime() > Date.now()) {
                                deal.endDateStr = `${months[d.getMonth()]} ${d.getDate()}`;
                                return deal; 
                            }
                        }
                    }
                }
            }
        } catch(e) {
            // Nu printăm nimic, ignorăm și trecem la varianta scurtă de căutare
        }
    }

    // Metoda extremă de rezervă: Citim HTML-ul paginii fără proxy-uri bușite
    if (deal.endDateStr === "Nespecificat") {
        try {
            let epicUrl = deal.link;
            
            // Extragem URL-ul curat trecând de Cheapshark
            if (epicUrl.includes("cheapshark.com/redirect")) {
                const redirRes = await axios.get(deal.link, { maxRedirects: 0, validateStatus: s => s >= 200 && s <= 308 });
                if (redirRes.headers.location) epicUrl = redirRes.headers.location;
            }
            
            const pageRes = await axios.get(epicUrl, {
                timeout: 8000,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36" }
            });
            
            const html = String(pageRes.data || "");
            const dateRegex = /"(?:endDate|discountEndDate)"\s*:\s*"(\d{4}-\d{2}-\d{2}T[^"]+)"/g;
            let match;
            let bestDate = null;
            const now = Date.now();

            while ((match = dateRegex.exec(html)) !== null) {
                const parsedDate = new Date(match[1]);
                const time = parsedDate.getTime();
                if (!isNaN(time) && time > now) {
                    if (!bestDate || time < bestDate.getTime()) {
                        bestDate = parsedDate;
                    }
                }
            }

            if (bestDate) {
                deal.endDateStr = `${months[bestDate.getMonth()]} ${bestDate.getDate()}`;
            }
        } catch(e) {}
    }
  }

  return deal;
}

async function checkForDiscounts() {
  const state = loadState();
  if (!state.discountsSubscribed || !state.discountChannelId) return;

  try {
    const deals = await fetchDeals();
    const channel = await client.channels.fetch(state.discountChannelId).catch(() => null);
    
    if (!channel) return;

    let newDealsFound = false;

    for (const deal of deals) {
      if (!state.seenDiscounts.includes(deal.id)) {
        state.seenDiscounts.push(deal.id);
        newDealsFound = true;

        const isFree = parseFloat(deal.salePrice) === 0;
        const embed = new EmbedBuilder()
          .setColor(isFree ? 0xffd700 : 0xe74c3c)
          .setTitle(String(`🚨 OFERTĂ NOUĂ: ${deal.title}`).slice(0, 250))
          .setDescription(`**${deal.store}** oferă o reducere masivă de **${deal.savings}%**!`)
          .addFields(
            { name: 'Preț Vechi', value: `~~$${deal.normalPrice}~~`, inline: true },
            { name: 'Preț Nou', value: isFree ? "🔥 GRATIS 🔥" : `$${deal.salePrice}`, inline: true },
            { name: 'Link Către Magazin', value: `[Apasă aici pentru ofertă](${deal.link})`, inline: false }
          )
          .setTimestamp();
          
        if (deal.thumbnail && deal.thumbnail.startsWith("http")) {
            embed.setThumbnail(deal.thumbnail);
        }

        await channel.send({ embeds: [embed] }).catch(err => console.error("Eroare trimitere embed reducere", err));
      }
    }

    if (newDealsFound) {
      if (state.seenDiscounts.length > 300) {
        state.seenDiscounts = state.seenDiscounts.slice(-300);
      }
      saveState(state);
    }

  } catch (error) {
    console.error("Eroare la căutarea reducerilor automate:", error.message);
  }
}

// -------------------------------------------------------------
// DISPECERUL PRINCIPAL
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

async function getConfiguredChannel() {
  const state = loadState();
  if (!state.notificationChannelId) return null;
  return await client.channels.fetch(state.notificationChannelId).catch(() => null);
}

async function sendUpdateToConfiguredChannel(gameName, latest) {
  const channel = await getConfiguredChannel();
  if (!channel) {
    console.log("Canalul de notificări nu este setat sau nu există.");
    return false;
  }

  try {
    const embed = buildUpdateEmbed(gameName, latest);
    await channel.send({ embeds: [embed] });
  } catch (error) {
    await channel.send(formatUpdateMessage(gameName, latest));
  }
  return true;
}

async function initializeSeenForCurrentGames() {
  const state = loadState();
  for (const game of config.games) {
    try {
      const latest = await fetchGameUpdate(game);
      state.seen[game.key] = latest.id;
    } catch (error) {
      console.error(`Nu am putut inițializa ${game.name}: ${error.message}`);
    }
  }
  saveState(state);
}

async function checkForUpdates() {
  const state = loadState();
  if (!state.subscribed || !state.notificationChannelId) return false;

  let foundSomething = false;
  for (const game of config.games) {
    try {
      const latest = await fetchGameUpdate(game);
      const previousId = state.seen[game.key];

      if (previousId !== latest.id) {
        state.seen[game.key] = latest.id;
        saveState(state);
        if (previousId) {
          await sendUpdateToConfiguredChannel(game.name, latest);
          foundSomething = true;
        }
      }
    } catch (error) {
      console.error(`Eroare la ${game.name}: ${error.message}`);
    }
  }
  return foundSomething;
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

client.once("ready", async () => {
  console.log("🤖 Botul este online și așteaptă comenzi.");
  console.log(`Conectat ca: ${client.user.tag}`);
  console.log(`🎮 Jocuri urmărite: ${config.games.map((g) => g.name).join(", ")}`);

  setInterval(async () => {
    try {
      await checkForUpdates();
      await checkForDiscounts();
    } catch (error) {
      console.error("Eroare în Loop-ul principal:", error);
    }
  }, Number(config.checkIntervalMinutes || 30) * 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const PREFIX = "big_master!";
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = (args.shift() || "").toLowerCase();

  if (command === "ping") {
    await message.reply("Pong! 🏓 Sistemele sunt operaționale.");
    return;
  }

  if (command === "games") {
    await message.reply(
      `🎮 **Jocuri urmărite:**\n${config.games.map((g) => `- **${g.name}**`).join("\n")}`
    );
    return;
  }

  if (command === "porecle") {
    const list = config.games.map((g) => `**${g.name}** -> folosește porecla: \`${g.key}\``).join("\n");
    await message.reply(
      `🏷️ **Lista de porecle pentru jocuri:**\nPentru a vedea ultimul update al unui joc specific, folosește comanda \`${PREFIX}latest [poreclă]\`.\n\n${list}`
    );
    return;
  }

  if (command === "startupdates") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply(`⛔ Doar un administrator poate folosi comanda **${PREFIX}startupdates**.`);
      return;
    }
    const state = loadState();
    state.notificationChannelId = message.channel.id;
    state.subscribed = true;
    saveState(state);
    await initializeSeenForCurrentGames();
    await message.reply("✅ Am pornit notificările automate pe acest canal. De acum înainte voi trimite doar update-urile viitoare.");
    return;
  }

  if (command === "stopupdates") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply(`⛔ Doar un administrator poate folosi comanda **${PREFIX}stopupdates**.`);
      return;
    }
    const state = loadState();
    state.subscribed = false;
    saveState(state);
    await message.reply("🛑 Am oprit notificările automate.");
    return;
  }

  if (command === "startreduceri") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`⛔ Doar un administrator poate folosi comanda **${PREFIX}startreduceri**.`);
    }
    const state = loadState();
    state.discountChannelId = message.channel.id;
    state.discountsSubscribed = true;
    saveState(state);
    await message.reply("✅ Am activat scannerul de reduceri masive (70%+ și gratuite) pentru Steam și Epic. Caut oferte acum...");
    await checkForDiscounts();
    return;
  }

  if (command === "stopreduceri") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply(`⛔ Doar un administrator poate folosi comanda **${PREFIX}stopreduceri**.`);
    }
    const state = loadState();
    state.discountsSubscribed = false;
    saveState(state);
    await message.reply("🛑 Am oprit notificările pentru reduceri.");
    return;
  }

  if (command === "latest") {
    // --- LATEST REDUCERI ---
    if (args.length > 0 && args[0].toLowerCase() === "reduceri") {
      const loadingMsg = await message.reply(`⏳ *Caut ofertele și extrag datele de expirare de pe Steam și Epic Games...*`);
      
      try {
        const deals = await fetchDeals(); 
        if (!deals || deals.length === 0) {
          await loadingMsg.edit(`❌ Momentan nu am găsit nicio ofertă care să îndeplinească criteriile.`);
          return;
        }

        await loadingMsg.delete().catch(() => null);
        const maxDeals = deals.slice(0, 50); 

        if (maxDeals.length > 10) {
          await message.channel.send(`ℹ️ *Am extras o selecție echilibrată de oferte Epic și Steam. Trimit câte 10 jocuri la fiecare 20 de secunde pentru a evita blocajele serverelor...*`);
        }

        for (let i = 0; i < maxDeals.length; i += 10) {
          const rawChunk = maxDeals.slice(i, i + 10);
          const chunk = await Promise.all(rawChunk.map(enrichDealData));
          const embedsToSend = [];

          for (const deal of chunk) {
            const isFree = parseFloat(deal.salePrice) === 0;
            const embed = new EmbedBuilder()
              .setColor(isFree ? 0x0099ff : 0x2b2d31)
              .setTitle(`${isFree ? "Free Game: " : "Reducere: "}${String(deal.title).slice(0, 200)}`)
              .setAuthor({ name: deal.store })
              .setDescription(
                `**Price:**\n~~$${deal.normalPrice}~~ ${isFree ? "FREE" : `$${deal.salePrice} (-${deal.savings}%)`}\n\n` +
                (deal.endDateStr !== "Nespecificat" ? `**Free until / Offer ends:**\n${deal.endDateStr}\n\n` : "") +
                (deal.store === "Steam" ? `**All Reviews:**\n${deal.steamRatingText}\n` : "") +
                (deal.extraDetails ? `${deal.extraDetails}\n\n` : "\n") +
                `🔗 [Accesează Magazinul](${deal.link})`
              );
              
            if (deal.thumbnail && deal.thumbnail.startsWith("http")) {
                embed.setImage(deal.thumbnail); 
            }
            
            embedsToSend.push(embed);
          }

          await message.channel.send({ embeds: embedsToSend }).catch(err => {
             console.error("Eroare la trimiterea unui mesaj de grup:", err);
          });

          if (i + 10 < maxDeals.length) {
            await new Promise(resolve => setTimeout(resolve, 20000));
          }
        }

      } catch (error) {
        await loadingMsg.edit(`❌ A apărut o eroare la extragerea datelor: \`${error.message}\``).catch(() => null);
        console.error("Eroare comanda latest reduceri:", error);
      }
      return; 
    }

    // --- LATEST (UPDATE JOCURI NORMAL) ---
    const state = loadState();
    const isAll = args.length === 0;
    const estType = isAll ? "all" : "single";
    const estMs = state.executionTimes?.[estType] || (isAll ? 15000 : 2000);
    const estSec = Math.max(1, Math.ceil(estMs / 1000)); 

    const loadingMsg = await message.reply(`⏳ *Mă conectez la serverele oficiale... Această acțiune va dura aproximativ **${estSec} secunde**.*`);
    const startTime = Date.now(); 

    if (isAll) {
      const results = await getLatestForAllGames();
      const elapsed = Date.now() - startTime;
      state.executionTimes[estType] = Math.round((estMs + elapsed) / 2);
      saveState(state);
      await loadingMsg.delete().catch(() => null);

      for (const result of results) {
        if (!result.latest) {
          await message.channel.send(`❌ Nu am putut lua ultimul update pentru **${result.game.name}**.`);
          continue;
        }
        try {
          await message.channel.send({ embeds: [buildUpdateEmbed(result.game.name, result.latest)] });
        } catch (error) {
          await message.channel.send(formatUpdateMessage(result.game.name, result.latest));
        }
      }
      return;
    }

    const gameText = args.join(" ");
    const game = findGameFromText(gameText);

    if (!game) {
      await loadingMsg.edit(`❌ Nu am găsit jocul. Folosește **${PREFIX}porecle** pentru listă.`);
      return;
    }

    try {
      const latest = await fetchGameUpdate(game);
      const elapsed = Date.now() - startTime;
      state.executionTimes[estType] = Math.round((estMs + elapsed) / 2);
      saveState(state);
      await loadingMsg.delete().catch(() => null);

      try {
        await message.channel.send({ embeds: [buildUpdateEmbed(game.name, latest)] });
      } catch (error) {
        await message.channel.send(formatUpdateMessage(game.name, latest));
      }
    } catch (error) {
      await loadingMsg.edit(`❌ Nu am putut lua ultimul update pentru **${game.name}**.`);
    }
    return;
  }

  if (command === "help") {
    const helpMessage =
      `🤖 **MENIUL DE AJUTOR - BIG MASTER** 🤖\n` +
      `Folosește prefixul \`${PREFIX}\` înainte de fiecare comandă.\n\n` +
      `**${PREFIX}help**\n` +
      `> Afișează acest meniu detaliat.\n\n` +
      `**${PREFIX}games**\n` +
      `> Vezi lista cu toate jocurile urmărite.\n\n` +
      `**${PREFIX}porecle**\n` +
      `> Vezi lista cu poreclele (prescurtările) jocurilor necesare pentru comanda latest.\n\n` +
      `**${PREFIX}latest**\n` +
      `> Vezi cele mai recente update-uri pentru toate jocurile.\n\n` +
      `**${PREFIX}latest [poreclă]**\n` +
      `> Vezi ultimul update pentru un joc specific.\n\n` +
      `**${PREFIX}latest reduceri**\n` +
      `> Vezi instantaneu top 50 oferte Steam și Epic Games, inclusiv datele de expirare.\n\n` +
      `**${PREFIX}startupdates** *(Admin)*\n` +
      `> Activează alertele automate de update-uri.\n\n` +
      `**${PREFIX}stopupdates** *(Admin)*\n` +
      `> Oprește alertele automate de update-uri.\n\n` +
      `**${PREFIX}startreduceri** *(Admin)*\n` +
      `> Pornește alertele pentru reduceri masive și jocuri gratis.\n\n` +
      `**${PREFIX}stopreduceri** *(Admin)*\n` +
      `> Oprește alertele de reduceri.\n\n` +
      `**${PREFIX}ping**\n` +
      `> Verifică dacă botul răspunde.`;

    await message.reply(helpMessage);
    return;
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error);
});
