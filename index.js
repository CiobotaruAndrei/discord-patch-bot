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
    .replace(/(<([^>]+)>)/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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
    "title update"
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
    embed.setTimestamp(new Date(latest.timestamp));
  }

  return embed;
}

// ==========================================
// STEAM
// ==========================================
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

  const cleanExcerpt = cleanText(latest.contents).slice(0, 700);
  const cleanSteamLink = `https://store.steampowered.com/news/app/${game.appId}/view/${latest.gid}`;

  return {
    id: String(latest.gid),
    title: cleanText(latest.title),
    link: cleanSteamLink,
    excerpt: cleanExcerpt || `A apărut un nou update pentru ${game.name}.`,
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : undefined
  };
}

// ==========================================
// MINECRAFT
// ==========================================
async function fetchMinecraftUpdate() {
  const manifestRes = await axios.get(
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    { timeout: 15000 }
  );

  const latestVersion = manifestRes?.data?.latest?.release;

  if (!latestVersion) {
    throw new Error("Date lipsă pe serverul Mojang.");
  }

  const manualArticleLinks = {
    // exemplu:
    // "26.1.1": "https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1-1"
  };

  const articleUrl = manualArticleLinks[latestVersion] || undefined;

  let articleText = `Ai de instalat o nouă versiune oficială Minecraft (${latestVersion}).`;
  let articleImage =
    "https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/MCV-keyart-default.jpg";

  if (articleUrl) {
    try {
      const articleRes = await axios.get(articleUrl, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
        }
      });

      const html = String(articleRes.data || "");

      const textMatch = html.match(/<meta name="description" content="([^"]+)"/i);
      if (textMatch && textMatch[1]) {
        articleText = htmlDecode(textMatch[1]);
      }

      const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      if (imgMatch && imgMatch[1]) {
        articleImage = imgMatch[1];
      }
    } catch (error) {
      console.error("Nu am putut lua articolul Minecraft:", error.message);
    }
  }

  return {
    id: String(latestVersion),
    title: `Minecraft: Java Edition ${latestVersion}`,
    link: articleUrl,
    excerpt: articleText,
    image: articleImage,
    thumbnail:
      "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg",
    timestamp: new Date().toISOString()
  };
}

// ==========================================
// FORTNITE
// ==========================================
function extractFortniteArticlePath(html) {
  const candidates = [];

  const regexes = [
    /href="(\/news\/[^"#?]+)"/gi,
    /"url":"(\/news\/[^"#?]+)"/gi,
    /https:\/\/www\.fortnite\.com(\/news\/[^"#?]+)/gi
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const raw = match[1];
      if (!raw) continue;

      const pathOnly = raw.startsWith("http")
        ? raw.replace(/^https:\/\/www\.fortnite\.com/i, "")
        : raw;

      const cleaned = pathOnly.split("?")[0].replace(/\/+$/, "");

      if (
        cleaned &&
        cleaned.startsWith("/news/") &&
        cleaned !== "/news" &&
        !cleaned.includes("/news/fortnite")
      ) {
        candidates.push(cleaned);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const unique = [...new Set(candidates)];

  unique.sort((a, b) => a.length - b.length);

  return unique[0];
}

async function fetchFortniteUpdate() {
  const aesRes = await axios.get("https://fortnite-api.com/v2/aes", {
    timeout: 15000
  });

  const build = aesRes?.data?.data?.build;

  if (!build) {
    throw new Error("Date lipsă Fortnite.");
  }

  let articleTitle = `Fortnite Update (Build ${build})`;
  let articleExcerpt = `A fost lansată o nouă versiune Fortnite de instalat (Build: ${build}).`;
  let articleImage = null;
  let articleLink = null;
  let articleTimestamp = new Date().toISOString();

  try {
    const newsPageRes = await axios.get("https://www.fortnite.com/news?lang=en-US", {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
      }
    });

    const newsHtml = String(newsPageRes.data || "");
    const articlePath = extractFortniteArticlePath(newsHtml);

    if (articlePath) {
      articleLink = `https://www.fortnite.com${articlePath}?lang=en-US`;

      const articleRes = await axios.get(articleLink, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
        }
      });

      const articleHtml = String(articleRes.data || "");

      const titleMatch = articleHtml.match(/<meta property="og:title" content="([^"]+)"/i);
      if (titleMatch && titleMatch[1]) {
        articleTitle = htmlDecode(titleMatch[1]);
      }

      const descMatch = articleHtml.match(/<meta property="og:description" content="([^"]+)"/i)
        || articleHtml.match(/<meta name="description" content="([^"]+)"/i);
      if (descMatch && descMatch[1]) {
        articleExcerpt = htmlDecode(descMatch[1]);
      }

      const imgMatch = articleHtml.match(/<meta property="og:image" content="([^"]+)"/i);
      if (imgMatch && imgMatch[1]) {
        articleImage = imgMatch[1];
      }

      const timeMatch = articleHtml.match(/<meta property="article:published_time" content="([^"]+)"/i);
      if (timeMatch && timeMatch[1]) {
        articleTimestamp = timeMatch[1];
      }
    }
  } catch (error) {
    console.error("Nu am putut lua articolul Fortnite:", error.message);
  }

  if (!articleLink) {
    try {
      const fallbackNews = await axios.get("https://fortnite-api.com/v2/news", {
        timeout: 15000
      });

      const latestNews = fallbackNews?.data?.data?.br?.motds?.[0];

      if (latestNews) {
        if (latestNews.title) {
          articleTitle = `${latestNews.title} (Build ${build})`;
        }
        if (latestNews.body) {
          articleExcerpt = latestNews.body;
        }
        if (latestNews.image) {
          articleImage = latestNews.image;
        }
      }
    } catch (error) {
      console.error("Nu am putut lua fallback news pt Fortnite:", error.message);
    }
  }

  return {
    id: String(build),
    title: articleTitle,
    link: articleLink || undefined,
    excerpt: articleExcerpt,
    image: articleImage,
    thumbnail:
      "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
    timestamp: articleTimestamp
  };
}

// ==========================================
// ROBLOX
// ==========================================
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

  if (game.type === "fortnite") {
    return await fetchFortniteUpdate();
  }

  if (game.type === "roblox") {
    return await fetchRobloxUpdate();
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
  if (!state.notificationChannelId) return null;
  return await client.channels.fetch(state.notificationChannelId).catch(() => null);
}

async function sendUpdateToConfiguredChannel(gameName, latest) {
  const channel = await getConfiguredChannel();
  if (!channel) return false;

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

    await message.reply("✅ Am pornit notificările automate pe acest canal.");
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
      await message.reply(`❌ Nu am găsit jocul. Folosește **${PREFIX}games** pentru listă.`);
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
      await message.reply(`❌ Nu am putut lua ultimul update pentru **${game.name}**.`);
    }

    return;
  }

  if (command === "help") {
    const helpMessage =
      `🤖 **MENIUL DE AJUTOR - BIG MASTER** 🤖\n` +
      `Folosește prefixul \`${PREFIX}\` înainte de fiecare comandă.\n\n` +
      `**${PREFIX}help**\n> Afișează acest meniu detaliat.\n\n` +
      `**${PREFIX}games**\n> Vezi lista cu toate jocurile urmărite.\n\n` +
      `**${PREFIX}latest**\n> Vezi cele mai recente update-uri pentru toate jocurile.\n\n` +
      `**${PREFIX}latest [nume_joc]**\n> Vezi ultimul update pentru un joc specific.\n\n` +
      `**${PREFIX}startupdates** *(Admin)*\n> Activează alertele automate pe canalul curent.\n\n` +
      `**${PREFIX}stopupdates** *(Admin)*\n> Oprește alertele automate.\n\n` +
      `**${PREFIX}ping**\n> Verifică dacă botul răspunde.`;

    await message.reply(helpMessage);
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error);
});
