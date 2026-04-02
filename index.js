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
          subscribed: false
        },
        null,
        2
      ),
      "utf8"
    );
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

function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags)
    ? item.tags.map((t) => String(t).toLowerCase())
    : [];

  const text = `${title} ${contents}`;

  const badWordsInTitle = [
    "community",
    "sale",
    "store",
    "merch",
    "tournament",
    "esports",
    "giveaway"
  ];

  const goodWords = [
    "update",
    "patch",
    "hotfix",
    "version",
    "release",
    "bugfix",
    "bug fix",
    "fixes",
    "fix",
    "notes",
    "patch notes",
    "changelog",
    "maintenance",
    "build",
    "client update",
    "title update",
    "release notes"
  ];

  if (badWordsInTitle.some((word) => title.includes(word))) {
    return false;
  }

  if (tags.includes("patchnotes")) {
    return true;
  }

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
    .setDescription(
      (latest.excerpt || `A apărut un nou update pentru ${gameName}.`).slice(0, 4000)
    )
    .setFooter({ text: gameName });

  if (latest.link) {
    embed.setURL(latest.link);
  }

  if (latest.image) {
    embed.setImage(latest.image);
  }

  if (latest.thumbnail) {
    embed.setThumbnail(latest.thumbnail);
  }

  if (latest.timestamp) {
    const date = new Date(latest.timestamp);
    if (!Number.isNaN(date.getTime())) {
      embed.setTimestamp(date);
    }
  }

  return embed;
}

function tokenize(text) {
  return cleanText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function scoreTextSimilarity(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = tokenize(b);

  if (!aTokens.size || !bTokens.length) return 0;

  let score = 0;
  for (const token of bTokens) {
    if (aTokens.has(token)) score += 1;
  }
  return score;
}

function parseAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = absoluteUrl(baseUrl, match[1]);
    const inner = cleanText(match[2]);

    anchors.push({
      href,
      text: inner
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

function isDirectSteamArticleUrl(url, appId) {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return false;
  if (/steamstatic\.com/.test(value)) return false;
  if (/steamcdn/.test(value)) return false;

  return (
    value.includes(`/news/app/${appId}/view/`) ||
    value.includes("steamcommunity.com/games/") ||
    value.includes("steamcommunity.com/app/")
  );
}

async function fetchSteamArticleLink(game, latestTitle, fallbackUrl) {
  if (isDirectSteamArticleUrl(fallbackUrl, game.appId)) {
    return fallbackUrl;
  }

  const newsHubUrl = `https://store.steampowered.com/news/app/${game.appId}`;

  try {
    const response = await axios.get(newsHubUrl, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const html = String(response.data || "");
    let anchors = parseAnchors(html, "https://store.steampowered.com");
    anchors = uniqueByHref(anchors);

    const candidates = anchors
      .filter((a) => isDirectSteamArticleUrl(a.href, game.appId))
      .map((a) => ({
        ...a,
        score: scoreTextSimilarity(latestTitle, a.text)
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      return candidates[0].href;
    }
  } catch (error) {
    console.error(`Nu am putut extrage articolul Steam pentru ${game.name}: ${error.message}`);
  }

  return newsHubUrl;
}

async function fetchSteamUpdate(game) {
  const apiUrl =
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/` +
    `?appid=${game.appId}&count=100&maxlength=2000&format=json`;

  const response = await axios.get(apiUrl, { timeout: 15000 });
  const newsItems = response?.data?.appnews?.newsitems;

  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    throw new Error("Lipsă date Steam.");
  }

  const patchNotes = newsItems.filter(isLikelyPatchNote);

  if (patchNotes.length === 0) {
    throw new Error("Niciun update recent detectat.");
  }

  patchNotes.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  const latest = patchNotes[0];

  if (!latest.gid || !latest.title) {
    throw new Error("Update invalid primit de la Steam.");
  }

  const chosenLink = await fetchSteamArticleLink(game, latest.title, latest.url);
  const cleanExcerpt = cleanText(latest.contents).slice(0, 700);

  return {
    id: String(latest.gid),
    title: cleanText(latest.title),
    link: chosenLink,
    excerpt: cleanExcerpt || `A apărut un nou update pentru ${game.name}.`,
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : undefined
  };
}

async function fetchListingBasedUpdate(game) {
  const listingUrls =
    Array.isArray(game.listingUrls) && game.listingUrls.length
      ? game.listingUrls
      : [game.listingUrl];

  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;

  let collected = [];

  for (const url of listingUrls) {
    const listRes = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const listHtml = String(listRes.data || "");
    let anchors = parseAnchors(listHtml, game.baseUrl);

    anchors = anchors.filter((a) => {
      if (!a.href) return false;
      if (hrefRegex && !hrefRegex.test(a.href)) return false;
      if (!keywords.length) return true;

      const bag = `${a.href} ${a.text}`.toLowerCase();
      return keywords.some((k) => bag.includes(String(k).toLowerCase()));
    });

    collected.push(...anchors);
  }

  collected = uniqueByHref(collected).map((a) => {
    const bag = `${a.href} ${a.text}`;
    let score = 0;

    for (const keyword of keywords) {
      if (bag.toLowerCase().includes(String(keyword).toLowerCase())) {
        score += 1;
      }
    }

    return { ...a, score };
  });

  collected.sort((a, b) => b.score - a.score);

  if (!collected.length) {
    throw new Error(`Nu am găsit articole de update pentru ${game.name}.`);
  }

  const articleUrl = collected[0].href;

  const articleRes = await axios.get(articleUrl, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const articleHtml = String(articleRes.data || "");

  return {
    id: String(articleUrl),
    title: extractTitleFromHtml(articleHtml) || `Update nou pentru ${game.name}`,
    link: articleUrl,
    excerpt:
      extractDescriptionFromHtml(articleHtml).slice(0, 700) ||
      `A apărut un nou update oficial pentru ${game.name}.`,
    image: extractImageFromHtml(articleHtml),
    thumbnail: game.thumbnail || undefined,
    timestamp: extractPublishedTimeFromHtml(articleHtml)
  };
}

async function fetchMinecraftUpdate() {
  const manifestRes = await axios.get(
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    { timeout: 15000 }
  );

  const latestVersion = manifestRes?.data?.latest?.release;

  if (!latestVersion) {
    throw new Error("Date lipsă pe serverul Mojang.");
  }

  const formattedVersion = latestVersion.replace(/\./g, "-");

  return {
    id: String(latestVersion),
    title: `Minecraft: Java Edition ${latestVersion}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${formattedVersion}`,
    excerpt: `O nouă versiune oficială (${latestVersion}) este disponibilă!`,
    image:
      "https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/MCV-keyart-default.jpg",
    thumbnail:
      "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg",
    timestamp: new Date().toISOString()
  };
}

async function fetchEpicGamesUpdate(game) {
  return await fetchListingBasedUpdate(game);
}

async function fetchRobloxUpdate() {
  const res = await axios.get(
    "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer",
    { timeout: 15000 }
  );

  const version = res?.data?.clientVersionUpload;

  if (!version) {
    throw new Error("Nu am putut accesa serverul de update Roblox.");
  }

  return {
    id: String(version),
    title: "Roblox Client Update",
    link: "https://en.help.roblox.com/hc/en-us/articles/203312870-Update-Log",
    excerpt: `Un nou client oficial Roblox a fost urcat pe servere (versiunea: ${version}).`,
    thumbnail:
      "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg",
    timestamp: new Date().toISOString()
  };
}

async function fetchGameUpdate(game) {
  if (!game.type || game.type === "steam") {
    return await fetchSteamUpdate(game);
  }

  if (game.type === "minecraft") {
    return await fetchMinecraftUpdate();
  }

  if (game.type === "epic_games") {
    return await fetchEpicGamesUpdate(game);
  }

  if (game.type === "roblox") {
    return await fetchRobloxUpdate();
  }

  if (game.type === "listing_based") {
    return await fetchListingBasedUpdate(game);
  }

  throw new Error(`Tip de joc necunoscut pentru ${game.name}.`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function getConfiguredChannel() {
  const state = loadState();

  if (!state.notificationChannelId) {
    return null;
  }

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

  if (!state.subscribed || !state.notificationChannelId) {
    console.log("Notificările automate nu sunt active.");
    return false;
  }

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
    } catch (error) {
      console.error("Eroare în checkForUpdates:", error);
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
      `🎮 **Jocuri urmărite:**\n${config.games
        .map((g) => `- **${g.name}** (${PREFIX}latest ${g.key})`)
        .join("\n")}`
    );
    return;
  }

  if (command === "startupdates") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply(
        `⛔ Doar un administrator poate folosi comanda **${PREFIX}startupdates**.`
      );
      return;
    }

    const state = loadState();
    state.notificationChannelId = message.channel.id;
    state.subscribed = true;
    saveState(state);

    await initializeSeenForCurrentGames();

    await message.reply(
      "✅ Am pornit notificările automate pe acest canal. De acum înainte voi trimite doar update-urile viitoare."
    );
    return;
  }

  if (command === "stopupdates") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply(
        `⛔ Doar un administrator poate folosi comanda **${PREFIX}stopupdates**.`
      );
      return;
    }

    const state = loadState();
    state.subscribed = false;
    saveState(state);

    await message.reply("🛑 Am oprit notificările automate.");
    return;
  }

  if (command === "latest") {
    if (args.length === 0) {
      const results = await getLatestForAllGames();

      for (const result of results) {
        if (!result.latest) {
          await message.channel.send(
            `❌ Nu am putut lua ultimul update pentru **${result.game.name}**.`
          );
          continue;
        }

        try {
          await message.channel.send({
            embeds: [buildUpdateEmbed(result.game.name, result.latest)]
          });
        } catch (error) {
          await message.channel.send(
            formatUpdateMessage(result.game.name, result.latest)
          );
        }
      }

      return;
    }

    const gameText = args.join(" ");
    const game = findGameFromText(gameText);

    if (!game) {
      await message.reply(
        `❌ Nu am găsit jocul. Folosește **${PREFIX}games** pentru listă.`
      );
      return;
    }

    try {
      const latest = await fetchGameUpdate(game);

      try {
        await message.channel.send({
          embeds: [buildUpdateEmbed(game.name, latest)]
        });
      } catch (error) {
        await message.channel.send(formatUpdateMessage(game.name, latest));
      }
    } catch (error) {
      await message.reply(
        `❌ Nu am putut lua ultimul update pentru **${game.name}**.`
      );
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
      `**${PREFIX}latest**\n` +
      `> Vezi cele mai recente update-uri pentru toate jocurile.\n\n` +
      `**${PREFIX}latest [nume_joc]**\n` +
      `> Vezi ultimul update pentru un joc specific.\n\n` +
      `**${PREFIX}startupdates** *(Admin)*\n` +
      `> Activează alertele automate pe canalul curent.\n\n` +
      `**${PREFIX}stopupdates** *(Admin)*\n` +
      `> Oprește alertele automate.\n\n` +
      `**${PREFIX}ping**\n` +
      `> Verifică dacă botul răspunde.`;

    await message.reply(helpMessage);
    return;
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error);
});
