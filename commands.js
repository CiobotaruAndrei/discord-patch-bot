"use strict";
// =============================================================
// commands.js — handler-e Discord, embeds, paginare, cache local,
// cron jobs.
//
// V4:
//   * Constantele de tuning citite din `env` (db.js), nu re-parsate
//   * checkForDiscounts marchează fetchDeals cu fromCron:true
//   * fix-urile anterioare (seen-before-send, migrare tolerantă, etc.)
//     toate păstrate
// =============================================================
const crypto = require("crypto");
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, MessageFlags, PermissionsBitField
} = require("discord.js");
const {
  GuildModel, logger, getSystemTimes, saveSystemTimes,
  getGuildSettings, invalidateGuildCache,
  env
} = require("./db");
const {
  cleanText, truncate, levenshtein,
  executeFetchWithCircuitBreaker, getLatestForAllGames,
  fetchDeals, enrichDealData, dealHash,
  searchSteamGameByName, chooseBestSteamMatch,
  fetchSteamPriceDetails, extractSteamOfferEndDate,
  httpReq, safeCheerioLoad,
  MAX_DEALS
} = require("./scrapers");
// -------------------------------------------------------------
// CONSTANTE — citite din env (validate centralizat în db.js)
// -------------------------------------------------------------
const PREFIX = "big_master!";
const CACHE_TTL_MS = 180000;
const GLOBAL_CACHE_TTL_MS = 1800000;
const CACHE_CLEAN_INTERVAL_MS = 300000;
const ITEMS_PER_PAGE = 5;
const DEALS_HISTORY_LIMIT = env.DEALS_HISTORY_LIMIT;
const SEEN_PER_GAME_LIMIT = env.SEEN_PER_GAME_LIMIT;
const PENDING_UPDATES_PER_GAME_LIMIT = env.PENDING_UPDATES_PER_GAME_LIMIT;
const PENDING_DISCOUNTS_LIMIT = env.PENDING_DISCOUNTS_LIMIT;
const PENDING_UPDATE_MAX_AGE_MS = env.PENDING_UPDATE_MAX_AGE_MS;
const PENDING_DISCOUNT_GRACE_CYCLES = env.PENDING_DISCOUNT_GRACE_CYCLES;
const PENDING_UPDATE_MAX_ATTEMPTS = env.PENDING_UPDATE_MAX_ATTEMPTS;
const MAX_UPDATES_PER_CYCLE = env.MAX_UPDATES_PER_CYCLE;
const MAX_DEALS_PER_CYCLE = env.MAX_DEALS_PER_CYCLE;
const DISCORD_SEND_DELAY_MS = env.DISCORD_SEND_DELAY_MS;
const GUILD_PROCESS_CONCURRENCY = env.GUILD_PROCESS_CONCURRENCY;
const DLC_CACHE_MAX_SIZE = 100;
const SINGLE_CACHE_MAX_SIZE = 100;
const DLC_ITEMS_PER_PAGE = 10;
const COMMAND_OUTPUT_MAX_CHARS = 1900;
// -------------------------------------------------------------
// MIGRARE TOLERANTĂ
// -------------------------------------------------------------
function normalizePendingUpdateArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (typeof item === "string") return null;
    if (!item || typeof item !== "object" || !item.id) return null;
    return {
      id: String(item.id),
      title: item.title || "",
      link: item.link || "",
      excerpt: item.excerpt || "",
      thumbnail: item.thumbnail || null,
      image: item.image || null,
      timestamp: item.timestamp || "",
      createdAt: item.createdAt || new Date(),
      attempts: typeof item.attempts === "number" ? item.attempts : 0
    };
  }).filter(Boolean);
}
function normalizePendingDiscountArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (typeof item === "string") return null;
    if (!item || typeof item !== "object" || !item.hash) return null;
    return {
      hash: String(item.hash),
      snapshot: item.snapshot || null,
      lastSeenAt: item.lastSeenAt || new Date(),
      attempts: typeof item.attempts === "number" ? item.attempts : 0
    };
  }).filter(Boolean);
}
// -------------------------------------------------------------
// CACHE LOCAL
// -------------------------------------------------------------
const cache = {
  updates: { data: null, expiresAt: 0 },
  deals: { data: null, expiresAt: 0 },
  single: new Map(),
  dlc: new Map()
};
function cacheGetLRU(map, key) {
  if (!map.has(key)) return null;
  const value = map.get(key);
  if (value.expiresAt < Date.now()) { map.delete(key); return null; }
  map.delete(key); map.set(key, value);
  return value.data;
}
function cacheSetLRU(map, key, data, ttlMs, maxSize) {
  if (map.has(key)) map.delete(key);
  map.set(key, { data, expiresAt: Date.now() + ttlMs });
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}
function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt < now) { cache.updates.data = null; cache.updates.expiresAt = 0; }
  if (cache.deals.expiresAt < now) { cache.deals.data = null; cache.deals.expiresAt = 0; }
  for (const [key, value] of cache.single.entries()) {
    if (value.expiresAt < now) cache.single.delete(key);
  }
  for (const [key, value] of cache.dlc.entries()) {
    if (value.expiresAt < now) cache.dlc.delete(key);
  }
  while (cache.dlc.size > DLC_CACHE_MAX_SIZE) {
    const oldestKey = cache.dlc.keys().next().value;
    if (oldestKey === undefined) break;
    cache.dlc.delete(oldestKey);
  }
  while (cache.single.size > SINGLE_CACHE_MAX_SIZE) {
    const oldestKey = cache.single.keys().next().value;
    if (oldestKey === undefined) break;
    cache.single.delete(oldestKey);
  }
}
function getCacheSizes() {
  return {
    single: cache.single.size,
    dlc: cache.dlc.size,
    updatesValid: cache.updates.expiresAt > Date.now(),
    dealsValid: cache.deals.expiresAt > Date.now()
  };
}
function startCacheCleaner() {
  const handle = setInterval(cleanCache, CACHE_CLEAN_INTERVAL_MS);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
// -------------------------------------------------------------
// UTILE DISCORD
// -------------------------------------------------------------
function smoothTime(oldMs, newMs, alpha = 0.3) {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}
function formatUserError(err, defaultMsg = "A apărut o eroare internă.", errorCode = null) {
  if (err) {
    const detail = err.stack ? err.stack : (err.message || err);
    logger("WARN", "USER_COMMAND", `${defaultMsg}${errorCode ? ` [${errorCode}]` : ""}`,
detail);
  }
  const suffix = errorCode ? ` \`[${errorCode}]\`` : "";
  return `\u274C ${defaultMsg}${suffix}`;
}
async function safeMessageEdit(message, payload, context = "MSG_EDIT") {
  if (!message) return null;
  try { return await message.edit(payload); }
  catch (err) {
    logger("WARN", context, "Nu am putut edita mesajul", err.message);
    return null;
  }
}
function canSendEmbeds(channel, botId) {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return perms && perms.has([PermissionsBitField.Flags.SendMessages,
PermissionsBitField.Flags.EmbedLinks]);
}
// Sleep care suportă corect 0 (no-op imediat)
async function sleepIfPositive(ms) {
  if (ms > 0) await new Promise(r => setTimeout(r, ms));
}
function dealPassesFilters(deal, guild) {
  const minDisc = guild?.minDiscountPercent || 0;
  const incFree = guild?.includeFreeGames !== false;
  const incPaid = guild?.includePaidDiscounts !== false;
  const isFree = parseFloat(deal.salePrice) === 0;
  if (isFree && !incFree) return false;
  if (!isFree && !incPaid) return false;
  if (!isFree && deal.savings < minDisc) return false;
  return true;
}
// -------------------------------------------------------------
// EMBEDS
// -------------------------------------------------------------
function buildUpdateEmbed(gameName, latest, mode = "detailed") {
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(truncate(latest.title, 256))
    .setFooter({ text: truncate(gameName, 2048) });
  if (latest.link) embed.setURL(latest.link);
  if (isCompact) {
    embed.setDescription(latest.link ? `Apasă pe titlu pentru a citi patch-ul.` : `A apărut un
nou update pentru ${gameName}.`);
  } else {
    embed.setDescription(truncate(latest.excerpt || `A apărut un nou update pentru
${gameName}.`, 4096));
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
    embed.setDescription(`**${deal.store}** | ~~$${deal.normalPrice}~~ -> **${isFree ? "GRATUIT"
: "$" + deal.salePrice}**\n[Apasă aici pentru link](${deal.link})`);
  } else {
    let statsStr = "";
    if (deal.qualityScore > 0) {
      statsStr = `\u2B50 **Calitate:** ${deal.qualityScore}% aprecieri | \u{1F465}
**Popularitate:** ${deal.totalReviews > 0 ? deal.totalReviews + " recenzii" : "Top
Seller"}\n\n`;
    }
    embed.setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(`**${deal.store}** oferă o reducere de **${deal.savings}%**!\n\n`
+ statsStr + (deal.endDateStr !== "Nespecificat" ? `\u23F3 **${isFree ? "Gratis până la" :
"Expiră la"}:** ${deal.endDateStr}\n\n` : ""), 4096))
      .addFields(
        { name: "Preț Vechi", value: `~~$${deal.normalPrice}~~`, inline: true },
        { name: "Preț Nou", value: isFree ? "\u{1F525} GRATUIT \u{1F525}" :
`$${deal.salePrice}`, inline: true },
        { name: "Link", value: `[Apasă aici](${deal.link})`, inline: false }
      );
    if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
    if (deal.extraDetails) embed.addFields({ name: "Detalii", value:
truncate(deal.extraDetails.trim(), 1024), inline: false });
  }
  return embed;
}
// -------------------------------------------------------------
// PAGINATION
// -------------------------------------------------------------
function buildPaginationButtons(prefix, sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("\u2B05
Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm
\u27A1").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}
async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage,
generateEmbedsFn, defaultMode = "detailed") {
  if (!items || items.length === 0) return;
  let currentPage = 0;
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
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
  collector = interactionMessage.createMessageComponentCollector({ componentType:
ComponentType.Button, time: 300000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) return btn.reply({ content: "Doar autorul comenzii poate
naviga!", flags: MessageFlags.Ephemeral }).catch(() => null);
    if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !==
`${prefix}_next_${sessionId}`) return;
    if (btn.customId === `${prefix}_prev_${sessionId}`) currentPage--;
    if (btn.customId === `${prefix}_next_${sessionId}`) currentPage++;
    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));
    await btn.deferUpdate().catch(() => null);
    await updateMessage();
  });
  collector.on("end", () => {
    if (interactionMessage.editable) interactionMessage.edit({ components: [] }).catch(() =>
null);
  });
}
// -------------------------------------------------------------
// GAME RESOLVER
// -------------------------------------------------------------
function findGameAndSuggestion(text, games) {
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length < 2) {
    const exact = games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }
  const candidates = [];
  for (const game of games) {
    const key = String(game.key).toLowerCase().replace(/[-_]/g, " ");
    const name = String(game.name).toLowerCase().replace(/[-_]/g, " ");
    const aliases = Array.isArray(game.aliases) ? game.aliases.map(a =>
String(a).toLowerCase().replace(/[-_]/g, " ")) : [];
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
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) return { game:
null, suggestion: best.game };
  return { game: null, suggestion: null };
}
// -------------------------------------------------------------
// STATUS
// -------------------------------------------------------------
async function fetchGameStatus(game) {
  let statusText = "Acest joc nu are un API de status public și oficial integrat în bot. Te
rugăm să verifici paginile oficiale de comunitate.";
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
      statusText = "Eroare la preluarea statusului automat. Te rugăm să verifici pagina
oficială.";
      statusLink = "https://status.epicgames.com/";
    }
  } else if (game.key === "roblox") {
    statusLink = "https://status.roblox.com/";
    statusText = "Apasă pe linkul de mai jos pentru a vedea starea oficială Roblox.";
  } else if (game.key === "valorant" || game.key === "lol") {
    statusLink = "https://status.riotgames.com/";
    statusText = "Apasă pe linkul de mai jos pentru a vedea starea oficială Riot Games.";
  } else if (game.key === "minecraft") {
    statusLink = "https://help.minecraft.net/hc/en-us/articles/360052646271-Minecraft-Server-
Status";
  } else {
    homepageLink = game.url || game.baseUrl || "Nu este disponibil un link oficial.";
  }
  const embed = new EmbedBuilder().setColor(color).setTitle(`\u{1F4E1} Status Servere:
${game.name}`).setDescription(statusText);
  if (statusLink && statusLink.startsWith("http")) {
    embed.addFields({ name: "\u{1F517} Pagină Oficială de Status", value: `[Verifică Statusul
Aici](${statusLink})` });
  } else if (homepageLink && homepageLink.startsWith("http")) {
    embed.addFields({ name: "\u{1F3E0} Pagină Principală / Fallback", value: `[Accesează
Homepage](${homepageLink})\n*(Acesta este link-ul general al jocului/producătorului, nu o pagină
automată de status)*` });
  }
  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}
function buildSteamPriceEmbed(gameData, appId, offerEndDate) {
  const typeStr = gameData.type === "game" ? "Joc"
    : gameData.type === "dlc" ? "DLC / Extensie"
    : gameData.type === "music" ? "Coloană Sonoră"
    : gameData.type === "demo" ? "Demo" : "Aplicație/Bundle";
  const title = gameData.name;
  const isFree = gameData.is_free;
  const priceOverview = gameData.price_overview;
  let embedDesc = `**Tip produs:** ${typeStr}\n\n`;
  let color = 0x2b2d31;
  if (isFree) {
    embedDesc += `Acest titlu este în prezent **GRATUIT** (Free to Play).`;
    color = 0xffd700;
  } else if (!priceOverview) {
    embedDesc += `Prețul nu este disponibil în acest moment (posibil să nu fi fost lansat încă
sau să nu poată fi cumpărat direct).`;
  } else {
    const normalPrice = (priceOverview.initial / 100).toFixed(2);
    const currentPrice = (priceOverview.final / 100).toFixed(2);
    const discountPercent = priceOverview.discount_percent;
    if (discountPercent > 0) {
      embedDesc += `Este o reducere activă de **${discountPercent}%**!\n\n~~$${normalPrice}~~ ->
**$${currentPrice}**`;
      color = 0xe74c3c;
      if (offerEndDate) embedDesc += `\n\u23F3 **Oferta expiră la:** ${offerEndDate}`;
      else embedDesc += `\n\u23F3 **Oferta expiră la:** Nespecificat (posibil ofertă permanentă
sau bundle).`;
    } else {
      embedDesc += `Nu este la reducere în acest moment.\n\nPreț standard: **$${normalPrice}**`;
      color = 0x57f287;
    }
  }
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`\u{1F3F7} Preț curent pe Steam: ${title}`)
    .setURL(`https://store.steampowered.com/app/${appId}`)
    .setDescription(embedDesc);
  if (gameData.header_image) embed.setImage(gameData.header_image);
  return embed;
}
// -------------------------------------------------------------
// CRON: checkForUpdates
// -------------------------------------------------------------
function buildPendingUpdate(latest) {
  return {
    id: latest.id,
    title: latest.title || "",
    link: latest.link || "",
    excerpt: latest.excerpt || "",
    thumbnail: latest.thumbnail || null,
    image: latest.image || null,
    timestamp: latest.timestamp || "",
    createdAt: new Date(),
    attempts: 0
  };
}
function pruneStaleUpdates(arr) {
  const now = Date.now();
  return arr.filter(p => {
    const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
    if (now - created > PENDING_UPDATE_MAX_AGE_MS) return false;
    if ((p.attempts || 0) >= PENDING_UPDATE_MAX_ATTEMPTS) return false;
    return true;
  });
}
async function processGuildUpdates(client, guild, validResults, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  let channel;
  try { channel = await client.channels.fetch(guild.notificationChannelId); }
  catch { return; }
  if (!canSendEmbeds(channel, client.user.id)) return;
  if (!guild.seen) guild.seen = {};
  if (!guild.pendingUpdates) guild.pendingUpdates = {};
  const seenSet = {};
  for (const [gk, ids] of Object.entries(guild.seen)) {
    seenSet[gk] = new Set(Array.isArray(ids) ? ids : []);
  }
  const pendingByGame = new Map();
  for (const [gk, arr] of Object.entries(guild.pendingUpdates)) {
    pendingByGame.set(gk, pruneStaleUpdates(normalizePendingUpdateArray(arr)));
  }
  for (const { game, latest } of validResults) {
    if (!latest) continue;
    const gk = game.key;
    const seen = seenSet[gk] || new Set();
    const existing = pendingByGame.get(gk) || [];
    if (seen.has(latest.id)) continue;
    if (existing.some(p => p.id === latest.id)) continue;
    existing.push(buildPendingUpdate(latest));
    while (existing.length > PENDING_UPDATES_PER_GAME_LIMIT) existing.shift();
    pendingByGame.set(gk, existing);
  }
  let sentCount = 0;
  const updatedSeenOps = {};
  const newPendingState = {};
  const gameByKey = new Map();
  for (const r of validResults) gameByKey.set(r.game.key, r.game);
  for (const [gk, queue] of pendingByGame.entries()) {
    if (queue.length === 0) {
      newPendingState[gk] = [];
      continue;
    }
    let remaining = queue.slice();
    while (remaining.length > 0 && sentCount < MAX_UPDATES_PER_CYCLE) {
      if (shouldAbort && shouldAbort()) break;
      const next = remaining[0];
      const game = gameByKey.get(gk);
      if (!game) { remaining.shift(); continue; }
      const gameName = game.name || gk;
      const embed = buildUpdateEmbed(gameName, next, guild.notificationMode || "detailed");
      try {
        const sentMessage = await channel.send({
          content: `\u{1F514} A apărut un update nou pentru **${gameName}**!`,
          embeds: [embed]
        });
        logger("INFO", "CRON_UPDATES_SENT", "Update trimis", {
          guildId: guild._id,
          gameKey: gk,
          updateId: next.id,
          messageId: sentMessage?.id || null
        });
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
        remaining.shift();
        sentCount++;
        updatedSeenOps[`seen.${gk}`] = updatedSeenOps[`seen.${gk}`] || { $each: [], $slice: -
SEEN_PER_GAME_LIMIT };
        updatedSeenOps[`seen.${gk}`].$each.push(next.id);
      } catch (err) {
        logger("WARN", "CRON_UPDATES", `Eroare la trimitere pe canal ${channel.id}`,
err.message);
        next.attempts = (next.attempts || 0) + 1;
        if (next.attempts >= PENDING_UPDATE_MAX_ATTEMPTS) {
          logger("WARN", "CRON_UPDATES", `Renunț la pending după ${next.attempts} încercări`, {
gameKey: gk, id: next.id });
          remaining.shift();
        } else {
          remaining.shift();
          remaining.push(next);
        }
        break;
      }
    }
    newPendingState[gk] = remaining;
    if (sentCount >= MAX_UPDATES_PER_CYCLE) {
      for (const [otherGk, otherQueue] of pendingByGame.entries()) {
        if (newPendingState[otherGk] === undefined) newPendingState[otherGk] = otherQueue;
      }
      break;
    }
  }
  const updateDoc = {};
  if (Object.keys(updatedSeenOps).length > 0) updateDoc.$push = updatedSeenOps;
  const $set = {};
  const $unset = {};
  for (const [gk, arr] of Object.entries(newPendingState)) {
    if (arr.length === 0) $unset[`pendingUpdates.${gk}`] = "";
    else $set[`pendingUpdates.${gk}`] = arr;
  }
  if (Object.keys($set).length > 0) updateDoc.$set = $set;
  if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;
  if (Object.keys(updateDoc).length > 0) {
    try {
      await GuildModel.updateOne({ _id: guild._id }, updateDoc);
      invalidateGuildCache(guild._id);
    } catch (err) {
      logger("ERROR", "CRON_UPDATES", `DB updateOne eșuat după trimitere — risc duplicat la
următorul ciclu`, {
        guildId: guild._id,
        sentInCycle: Object.keys(updatedSeenOps).length,
        error: err.message
      });
    }
  }
}
async function checkForUpdates(client, games, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  const guilds = await GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null }
}).lean();
  if (!guilds.length) return;
  // Propagăm shouldAbort → context "cron" pentru coalescing
  const results = await getLatestForAllGames(games, shouldAbort);
  const validResults = results.filter(r => r.latest !== null);
  if (!validResults.length) return;
  let nextIndex = 0;
  async function worker() {
    while (true) {
      if (shouldAbort && shouldAbort()) return;
      const myIndex = nextIndex++;
      if (myIndex >= guilds.length) return;
      try {
        await processGuildUpdates(client, guilds[myIndex], validResults, shouldAbort);
      } catch (err) {
        logger("WARN", "CRON_UPDATES", `Eroare procesare guild ${guilds[myIndex]._id}`,
err.message);
      }
    }
  }
  const workerCount = Math.min(GUILD_PROCESS_CONCURRENCY, guilds.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
}
// -------------------------------------------------------------
// CRON: checkForDiscounts
// -------------------------------------------------------------
async function processGuildDiscounts(client, guild, deals, dealsByHash, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  let channel;
  try { channel = await client.channels.fetch(guild.discountChannelId); }
  catch { return; }
  if (!canSendEmbeds(channel, client.user.id)) return;
  const seenSet = new Set(guild.seenDiscounts || []);
  const oldPending = normalizePendingDiscountArray(guild.pendingDiscounts);
  const queue = [];
  const inQueueHashes = new Set();
  for (const p of oldPending) {
    const fresh = dealsByHash.get(p.hash);
    if (fresh) {
      queue.push({ hash: p.hash, snapshot: fresh, attempts: 0, lastSeenAt: new Date() });
      inQueueHashes.add(p.hash);
    } else {
      const newAttempts = (p.attempts || 0) + 1;
      if (newAttempts < PENDING_DISCOUNT_GRACE_CYCLES && p.snapshot) {
        if (dealPassesFilters(p.snapshot, guild)) {
          queue.push({
            hash: p.hash,
            snapshot: p.snapshot,
            attempts: newAttempts,
            lastSeenAt: p.lastSeenAt || new Date()
          });
          inQueueHashes.add(p.hash);
        }
      }
    }
  }
  for (const deal of deals) {
    const h = dealHash(deal);
    if (seenSet.has(h)) continue;
    if (inQueueHashes.has(h)) continue;
    if (!dealPassesFilters(deal, guild)) continue;
    queue.push({ hash: h, snapshot: deal, attempts: 0, lastSeenAt: new Date() });
    inQueueHashes.add(h);
  }
  const sentHashes = [];
  let sentCount = 0;
  const remainingQueue = [];
  for (let i = 0; i < queue.length; i++) {
    if (shouldAbort && shouldAbort()) {
      remainingQueue.push(...queue.slice(i));
      break;
    }
    const entry = queue[i];
    if (sentCount >= MAX_DEALS_PER_CYCLE) {
      remainingQueue.push(entry);
      continue;
    }
    const deal = entry.snapshot;
    if (!deal) continue;
    try { await enrichDealData(deal); } catch { /* fail-soft */ }
    const embed = buildDealEmbed(deal, guild.notificationMode || "detailed");
    try {
      const sentMessage = await channel.send({ content: `\u{1F525} Ofertă nouă detectată!`,
embeds: [embed] });
      logger("INFO", "CRON_DISCOUNTS_SENT", "Ofertă trimisă", {
        guildId: guild._id,
        hash: entry.hash,
        title: deal.title,
        messageId: sentMessage?.id || null
      });
      await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      sentHashes.push(entry.hash);
      sentCount++;
    } catch (err) {
      logger("WARN", "CRON_DISCOUNTS", `Eroare trimitere oferte canal ${channel.id}`,
err.message);
      entry.attempts = (entry.attempts || 0) + 1;
      remainingQueue.push(entry);
    }
  }
  const finalPending = remainingQueue.slice(-PENDING_DISCOUNTS_LIMIT);
  const updateDoc = {};
  if (sentHashes.length > 0) {
    updateDoc.$push = { seenDiscounts: { $each: sentHashes, $slice: -DEALS_HISTORY_LIMIT } };
  }
  updateDoc.$set = { pendingDiscounts: finalPending };
  try {
    await GuildModel.updateOne({ _id: guild._id }, updateDoc);
    invalidateGuildCache(guild._id);
  } catch (err) {
    logger("ERROR", "CRON_DISCOUNTS", `DB updateOne eșuat după trimitere — risc duplicat la
următorul ciclu`, {
      guildId: guild._id,
      sentInCycle: sentHashes.length,
      error: err.message
    });
  }
}
async function checkForDiscounts(client, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  const guilds = await GuildModel.find({
    discountsSubscribed: true,
    discountChannelId: { $ne: null }
  }).lean();
  if (!guilds.length) return;
  let deals;
  try {
    // fromCron:true → coalescing separat de comenzile manuale
    deals = await fetchDeals({ fromCron: true });
  }
  catch (err) {
    return logger("WARN", "CRON_DISCOUNTS", "Eroare fetch oferte cron", err.message);
  }
  const dealsByHash = new Map();
  for (const d of deals) dealsByHash.set(dealHash(d), d);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      if (shouldAbort && shouldAbort()) return;
      const myIndex = nextIndex++;
      if (myIndex >= guilds.length) return;
      try {
        await processGuildDiscounts(client, guilds[myIndex], deals, dealsByHash, shouldAbort);
      } catch (err) {
        logger("WARN", "CRON_DISCOUNTS", `Eroare procesare guild ${guilds[myIndex]._id}`,
err.message);
      }
    }
  }
  const workerCount = Math.min(GUILD_PROCESS_CONCURRENCY, guilds.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
}
// -------------------------------------------------------------
// HANDLERS COMENZI
// -------------------------------------------------------------
async function handleStart(message, subCommand, guildId, games) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("\u26D4 Doar un admin.");
  }
  if (subCommand === "updates") {
    const msg = await message.reply("\u23F3 Setez canalul...");
    try {
      // Comandă manuală — fără shouldAbort (context "manual")
      const results = await getLatestForAllGames(games);
      const setPayload = {
        subscribed: true,
        notificationChannelId: message.channel.id,
        pendingUpdates: {}
      };
      for (const r of results) if (r.latest) setPayload[`seen.${r.game.key}`] = [r.latest.id];
      await GuildModel.updateOne({ _id: guildId }, { $set: setPayload }, { upsert: true });
      invalidateGuildCache(guildId);
      return msg.edit("\u2705 Update-uri automate activate.");
    } catch (err) {
      return msg.edit(formatUserError(err, "Eroare la inițializarea datelor."));
    }
  }
  if (subCommand === "reduceri") {
    const msg = await message.reply("\u23F3 Setez canalul oferte...");
    try {
      // Comandă manuală — fără fromCron (context "manual")
      const deals = await fetchDeals();
      const initHashes = deals.map(d => dealHash(d)).slice(-DEALS_HISTORY_LIMIT);
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: {
            discountsSubscribed: true,
            discountChannelId: message.channel.id,
            seenDiscounts: initHashes,
            pendingDiscounts: []
        }},
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return msg.edit("\u2705 Alertele reduceri activate!");
    } catch (err) {
      return msg.edit(formatUserError(err, "Eroare internă la preluarea ofertelor."));
    }
  }
  return message.reply(`\u274C Sintaxă: \`${PREFIX}start updates\` sau \`${PREFIX}start
reduceri\`.`);
}
async function handleStop(message, subCommand, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("\u26D4 Doar un admin.");
  }
  try {
    if (subCommand === "updates") {
      await GuildModel.updateOne({ _id: guildId }, {
        $set: { subscribed: false, notificationChannelId: null, pendingUpdates: {} }
      });
      invalidateGuildCache(guildId);
      return message.reply("\u{1F6D1} Update-uri oprite.");
    }
    if (subCommand === "reduceri") {
      await GuildModel.updateOne({ _id: guildId }, {
        $set: { discountsSubscribed: false, discountChannelId: null, pendingDiscounts: [] }
      });
      invalidateGuildCache(guildId);
      return message.reply("\u{1F6D1} Reduceri oprite.");
    }
  } catch (err) {
    return message.reply(formatUserError(err, "Eroare la baza de date."));
  }
  return message.reply(`\u274C Sintaxă: \`${PREFIX}stop updates\` sau \`${PREFIX}stop
reduceri\`.`);
}
async function handleSetCommand(message, args, guildId) {
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("\u26D4 Doar admin.");
  }
  const setting = (args[0] || "").toLowerCase();
  const value = (args[1] || "").toLowerCase();
  if (!setting || !value) return message.reply(`\u2699 Setări: mode, mindiscount, free, paid.`);
  const updateDoc = {};
  const filterAffectingSettings = new Set(["mindiscount", "free", "paid"]);
  const isFilterChange = filterAffectingSettings.has(setting);
  let confirmMsg = "";
  switch (setting) {
    case "mode": {
      if (!["compact", "detailed"].includes(value)) return message.reply("\u274C Permise:
`compact` sau `detailed`.");
      updateDoc.notificationMode = value;
      confirmMsg = `\u2705 Mod setat: **${value}**`;
      break;
    }
    case "mindiscount": {
      const min = parseInt(value, 10);
      if (isNaN(min) || min < 0 || min > 100) return message.reply("\u274C 0-100.");
      updateDoc.minDiscountPercent = min;
      confirmMsg = `\u2705 Reducere minimă: **${min}%**`;
      break;
    }
    case "free": {
      if (!["on", "off"].includes(value)) return message.reply("\u274C `on` / `off`.");
      updateDoc.includeFreeGames = value === "on";
      confirmMsg = `\u2705 Jocuri free: **${value.toUpperCase()}**`;
      break;
    }
    case "paid": {
      if (!["on", "off"].includes(value)) return message.reply("\u274C `on` / `off`.");
      updateDoc.includePaidDiscounts = value === "on";
      confirmMsg = `\u2705 Oferte plătite: **${value.toUpperCase()}**`;
      break;
    }
    default: return message.reply("\u274C Setare necunoscută.");
  }
  if (isFilterChange) updateDoc.pendingDiscounts = [];
  try {
    await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true });
    invalidateGuildCache(guildId);
    return message.reply(confirmMsg + (isFilterChange ? " *(coada de pending a fost resetată)*"
: ""));
  } catch (err) {
    return message.reply(formatUserError(err, "Eroare la salvarea preferințelor."));
  }
}
async function handleLatestUpdates(message, games) {
  let msg = null;
  if (!cache.updates.data) {
    const estMs = (await getSystemTimes()).all || 35000;
    msg = await message.reply(`\u23F3 *Durată estimată: **${Math.max(1, Math.ceil(estMs /
1000))} secunde***`);
    const startTime = Date.now();
    try {
      // Context manual — fără shouldAbort
      const results = await getLatestForAllGames(games);
      cache.updates = { data: results, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
      const sys = await getSystemTimes();
      sys.all = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    } catch (err) {
      return safeMessageEdit(msg, formatUserError(err, "Nu am reușit să obțin update-urile.",
"ERR_LATEST_UPDATES"), "LATEST_UPDATES");
    }
  }
  const valid = cache.updates.data.filter(r => r.latest !== null);
  if (!valid.length) {
    return msg
      ? safeMessageEdit(msg, "\u274C Nu am date disponibile.", "LATEST_UPDATES")
      : message.reply("\u274C Nu am date disponibile.");
  }
  const guild = await getGuildSettings(message.guild.id);
  const mode = guild?.notificationMode || "detailed";
  if (msg) await safeMessageEdit(msg, "\u2705 Date încărcate!", "LATEST_UPDATES");
  else msg = await message.reply("\u2705 Date încărcate!");
  const generateEmbeds = async (page, totalP, currentMode) =>
    valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r =>
      buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} •
Pagina ${page + 1}/${totalP}` })
    );
  await handlePagination(msg, message.author.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds,
mode);
}
async function handleLatestDeals(message) {
  let msg = null;
  if (!cache.deals.data) {
    const estMs = (await getSystemTimes()).reduceri || 10000;
    msg = await message.reply(`\u23F3 *Durată estimată: **${Math.max(1, Math.ceil(estMs /
1000))} secunde***`);
    const startTime = Date.now();
    try {
      // Context manual
      const rawDeals = await fetchDeals();
      cache.deals = { data: rawDeals, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
      const sys = await getSystemTimes();
      sys.reduceri = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    } catch (err) {
      return safeMessageEdit(msg, formatUserError(err, "Nu am putut interoga magazinele.",
"ERR_LATEST_DEALS"), "LATEST_DEALS");
    }
  }
  const guild = await getGuildSettings(message.guild.id);
  const mode = guild?.notificationMode || "detailed";
  const top = cache.deals.data.filter(d => dealPassesFilters(d, guild)).slice(0, MAX_DEALS);
  if (!top.length) {
    return msg
      ? safeMessageEdit(msg, "\u274C Nu am găsit oferte care să corespundă setărilor
serverului.", "LATEST_DEALS")
      : message.reply("\u274C Nu am găsit oferte care să corespundă setărilor serverului.");
  }
  if (msg) await safeMessageEdit(msg, "\u2705 Oferte încărcate!", "LATEST_DEALS");
  else msg = await message.reply("\u2705 Oferte încărcate!");
  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    if (currentMode !== "compact") {
      for (const d of chunk) {
        try { await enrichDealData(d); }
        catch (e) { logger("WARN", "ENRICH", "Eroare enrich command handler", e.message); }
      }
    }
    return chunk.map(d => buildDealEmbed(d, currentMode).setFooter({ text: `Pagina ${page +
1}/${totalP}` }));
  };
  await handlePagination(msg, message.author.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds,
mode);
}
async function handleLatestSingle(message, gameText, games) {
  if (!gameText) return message.reply(`\u274C Ex: \`${PREFIX}latest update cs2\`.`);
  const estMs = (await getSystemTimes()).single || 2000;
  const loadingMsg = await message.reply(`\u23F3 *Mă conectez... Durată estimată:
**${Math.max(1, Math.ceil(estMs / 1000))} secunde**.*`);
  const startTime = Date.now();
  const { game, suggestion } = findGameAndSuggestion(gameText, games);
  if (!game) {
    let errText = `\u274C Nu am găsit jocul.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}**
(\`${suggestion.key}\`)?`;
    return safeMessageEdit(loadingMsg, errText, "LATEST_SINGLE");
  }
  try {
    let latest = cacheGetLRU(cache.single, game.key);
    if (latest === null) {
      const res = await executeFetchWithCircuitBreaker(game);
      if (res.error) throw new Error(res.error);
      latest = res.latest;
      cacheSetLRU(cache.single, game.key, latest, CACHE_TTL_MS, SINGLE_CACHE_MAX_SIZE);
      const executionTimes = await getSystemTimes();
      executionTimes.single = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(executionTimes);
    }
    const guild = await getGuildSettings(message.guild.id);
    await safeMessageEdit(loadingMsg, {
      content: `\u2705 Update **${game.name}**:`,
      embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")]
    }, "LATEST_SINGLE");
  } catch (error) {
    await safeMessageEdit(loadingMsg,
      formatUserError(error, "Nu am putut prelua acest update.", "ERR_LATEST_SINGLE"),
      "LATEST_SINGLE");
  }
}
async function handlePriceSearch(message, gameName) {
  if (!gameName) return message.reply(`\u274C Trebuie să specifici un joc. Ex: \`${PREFIX}latest
pret cyberpunk\`.`);
  const loadingMsg = await message.reply(`\u23F3 *Caut prețul pe Steam pentru
**${gameName}**...*`);
  try {
    let items;
    try { items = await searchSteamGameByName(gameName); }
    catch (e) {
      return safeMessageEdit(loadingMsg,
        `\u274C Eroare la conectarea cu serverele Steam. Te rugăm să încerci mai târziu.
\`[ERR_STEAM_CONN]\``,
        "PRICE_SEARCH");
    }
    if (!items || items.length === 0) {
      logger("WARN", "PRICE_SEARCH", `Joc negăsit pe Steam pentru query-ul: ${gameName}`);
      return safeMessageEdit(loadingMsg,
        `\u274C Nu am găsit niciun rezultat pe Steam pentru "**${gameName}**".`,
        "PRICE_SEARCH");
    }
    const bestMatch = chooseBestSteamMatch(items, gameName, { forceGameOnly: true });
    if (!bestMatch || !bestMatch.id) {
      return safeMessageEdit(loadingMsg, `\u274C Nu am putut selecta un rezultat valid de pe
Steam.`, "PRICE_SEARCH");
    }
    const bestMatchId = bestMatch.id;
    logger("INFO", "PRICE_SEARCH", `Pentru "${gameName}" am selectat ID: ${bestMatchId} (Nume:
${bestMatch.name})`);
    let gameData;
    try { gameData = await fetchSteamPriceDetails(bestMatchId); }
    catch (e) {
      return safeMessageEdit(loadingMsg,
        `\u274C Steam API nu a putut returna detaliile pentru acest titlu.
\`[ERR_STEAM_DETAILS]\``,
        "PRICE_SEARCH");
    }
    if (!gameData) {
      logger("WARN", "PRICE_SEARCH", `Detalii indisponibile pentru appID: ${bestMatchId}`);
      return safeMessageEdit(loadingMsg,
        `\u274C Am găsit un rezultat, dar detaliile de preț nu sunt disponibile (posibil blocat
regional sau nelistat).`,
        "PRICE_SEARCH");
    }
    let offerEndDate = null;
    if (gameData.price_overview && gameData.price_overview.discount_percent > 0) {
      offerEndDate = await extractSteamOfferEndDate(bestMatchId);
    }
    const embed = buildSteamPriceEmbed(gameData, bestMatchId, offerEndDate);
    await safeMessageEdit(loadingMsg, { content: "\u2705 Am obținut datele de pe Steam!",
embeds: [embed] }, "PRICE_SEARCH");
  } catch (err) {
    await safeMessageEdit(loadingMsg,
      `\u274C A apărut o eroare neașteptată la căutarea prețului. \`[ERR_PRICE_GENERAL]\``,
      "PRICE_SEARCH");
    logger("ERROR", "PRICE_SEARCH", "Eroare finală nespecificată la căutare preț", err.message);
  }
}
async function handleDlcSearch(message, gameName) {
  if (!gameName) return message.reply(`\u274C Trebuie să specifici un joc. Ex: \`${PREFIX}dlc
cyberpunk\`.`);
  const loadingMsg = await message.reply(`\u23F3 *Caut DLC-urile pentru **${gameName}**...*`);
  try {
    let items;
    try { items = await searchSteamGameByName(gameName); }
    catch (e) {
      return safeMessageEdit(loadingMsg, `\u274C Eroare la conectarea cu serverele Steam.
\`[ERR_STEAM_CONN]\``, "DLC_SEARCH");
    }
    if (!items || items.length === 0) {
      return safeMessageEdit(loadingMsg, `\u274C Nu am găsit niciun rezultat pe Steam pentru
"**${gameName}**".`, "DLC_SEARCH");
    }
    let bestMatch = chooseBestSteamMatch(items, gameName, { forceGameOnly: true });
    if (!bestMatch || !bestMatch.id) {
      return safeMessageEdit(loadingMsg, `\u274C Nu am putut selecta un joc valid de pe Steam.`,
"DLC_SEARCH");
    }
    if (String(bestMatch.type || "").toLowerCase() !== "game") {
      const baseGame = items.find(item => typeof item.type === "string" &&
item.type.toLowerCase() === "game");
      if (baseGame) {
        bestMatch = baseGame;
        logger("INFO", "DLC_SEARCH", `Fallback la joc de bază pentru query: ${gameName}`);
      }
    }
    const cacheKey = bestMatch.id;
    let dlcData = cacheGetLRU(cache.dlc, cacheKey);
    if (dlcData === null) {
      const title = bestMatch.name;
      let gameDetails;
      try { gameDetails = await fetchSteamPriceDetails(cacheKey); }
      catch (e) { logger("WARN", "DLC_SEARCH", `Nu am putut prelua header_image pentru
${cacheKey}`); }
      const thumbUrl = gameDetails?.header_image
        || `https://cdn.akamai.steamstatic.com/steam/apps/${cacheKey}/header.jpg`;
      const htmlRes = await httpReq("GET", `https://store.steampowered.com/app/${cacheKey}`, {
        headers: { "Cookie": "birthtime=283993201; mature_content=1;" },
        timeout: 15000
      });
      const $ = safeCheerioLoad(htmlRes.data);
      if ($("#agegate_box").length > 0 || $(".agegate_text_container").length > 0
          || htmlRes.request?.path?.includes("agecheck")) {
        return safeMessageEdit(loadingMsg,
          `\u274C Pagina de Steam pentru **${title}** necesită verificare de vârstă, iar botul
nu o poate accesa direct.`,
          "DLC_SEARCH");
      }
      const dlcList = [];
      const seenDlcIds = new Set();
      $(".game_area_dlc_row").each((i, el) => {
        const dlcName = $(el).find(".game_area_dlc_name").text().trim();
        let dlcPrice = $(el).find(".game_area_dlc_price").text().trim();
        const dlcAppId = $(el).attr("data-ds-appid") || dlcName;
        dlcPrice = dlcPrice.replace(/\s+/g, " ");
        if (!dlcPrice || dlcPrice === "") dlcPrice = "Preț indisponibil";
        if (dlcName && !seenDlcIds.has(dlcAppId)) {
          seenDlcIds.add(dlcAppId);
          dlcList.push({ name: dlcName, price: dlcPrice });
        }
      });
      if (dlcList.length === 0) {
        if ($(".game_area_purchase_game").length === 0) {
          return safeMessageEdit(loadingMsg,
            `\u274C Structura paginii pentru **${title}** nu a putut fi interpretată (posibil
regiune blocată sau pachet special).`,
            "DLC_SEARCH");
        }
        return safeMessageEdit(loadingMsg,
          `\u274C Jocul **${title}** nu are niciun DLC listat separat pe magazinul Steam.`,
          "DLC_SEARCH");
      }
      const totalExtracted = dlcList.length;
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: cacheKey, thumbUrl,
totalExtracted };
      cacheSetLRU(cache.dlc, cacheKey, dlcData, CACHE_TTL_MS, DLC_CACHE_MAX_SIZE);
    }
    const { dlcList, title, appId: finalAppId, thumbUrl: finalThumbUrl, totalExtracted } =
dlcData;
    await safeMessageEdit(loadingMsg, `\u2705 Am găsit **${totalExtracted}** DLC-uri pentru
**${title}**!`, "DLC_SEARCH");
    const itemsPerPage = DLC_ITEMS_PER_PAGE;
    const generateEmbeds = async (page, totalP) => {
      const chunk = dlcList.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`\u{1F4E6} DLC-uri: ${title}`)
        .setURL(`https://store.steampowered.com/app/${finalAppId}`)
        .setThumbnail(finalThumbUrl);
      let desc = "";
      chunk.forEach((dlc, index) => {
        const globalIndex = page * itemsPerPage + index + 1;
        desc += `**${globalIndex}. ${truncate(dlc.name, 100)}**\n\u{1F4B5} ${dlc.price}\n\n`;
      });
      embed.setDescription(desc);
      embed.setFooter({ text: `Pagina ${page + 1}/${totalP} • Afișate: ${dlcList.length} /
Extrase: ${totalExtracted}` });
      return [embed];
    };
    await handlePagination(loadingMsg, message.author.id, "dlc_cmd", dlcList, itemsPerPage,
generateEmbeds, "detailed");
  } catch (err) {
    await safeMessageEdit(loadingMsg,
      `\u274C A apărut o eroare la căutarea DLC-urilor. \`[ERR_DLC_GENERAL]\``,
      "DLC_SEARCH");
    logger("ERROR", "DLC_SEARCH", "Eroare la extragere DLC-uri", err.message);
  }
}
async function handleStatus(message, gameText, games) {
  if (!gameText) return message.reply(`\u274C Trebuie să specifici un joc. Ex: \`${PREFIX}status
fortnite\`.`);
  const loadingMsg = await message.reply(`\u23F3 *Verific statusul serverelor pentru
**${gameText}**...*`);
  const { game, suggestion } = findGameAndSuggestion(gameText, games);
  if (!game) {
    let errText = `\u274C Nu am găsit jocul în baza mea de date.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}**
(\`${suggestion.key}\`)?`;
    return safeMessageEdit(loadingMsg, errText, "STATUS");
  }
  try {
    const embed = await fetchGameStatus(game);
    await safeMessageEdit(loadingMsg, {
      content: `\u2705 Informații preluate pentru **${game.name}**:`,
      embeds: [embed]
    }, "STATUS");
  } catch (err) {
    await safeMessageEdit(loadingMsg,
      `\u274C A apărut o eroare la preluarea statusului. \`[ERR_STATUS_GENERAL]\``,
      "STATUS");
    logger("ERROR", "STATUS", "Eroare la comanda status", err.message);
  }
}
function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("\u{1F916} Meniul de Ajutor - Big Master")
    .addFields(
      { name: "\u{1F6E0} Comenzi Utilitare Generale",
        value: `\`${PREFIX}ping\`\n\`${PREFIX}games\` (sau \`${PREFIX}porecle\`)` },
      { name: "\u{1F514} Notificări Automate",
        value: `\`${PREFIX}start updates\`\n\`${PREFIX}stop updates\`\n\`${PREFIX}start
reduceri\`\n\`${PREFIX}stop reduceri\`` },
      { name: "\u2699 Preferințe Server",
        value: `\`${PREFIX}set mode [compact/detailed]\`\n\`${PREFIX}set mindiscount [0-
100]\`\n\`${PREFIX}set free [on/off]\`\n\`${PREFIX}set paid [on/off]\`` },
      { name: "\u{1F50D} Comenzi Manuale",
        value: `\`${PREFIX}latest updates\`\n\`${PREFIX}latest reduceri\`\n\`${PREFIX}latest
update [poreclă]\`\n\`${PREFIX}latest pret [nume joc]\`\n\`${PREFIX}dlc [nume
joc]\`\n\`${PREFIX}status [nume joc]\`` }
    );
}
async function handleGamesCommand(message, games) {
  const lines = games.map(g => {
    let item = `- **${g.name}** (\`${g.key}\`)`;
    if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
    return item;
  });
  let currentMsg = "\u{1F3AE} **Jocuri urmărite:**\n";
  for (const line of lines) {
    if (currentMsg.length + line.length > COMMAND_OUTPUT_MAX_CHARS) {
      if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
      currentMsg = "";
    }
    currentMsg += line + "\n";
  }
  if (currentMsg.trim() !== "") await message.reply(currentMsg).catch(() => null);
}
module.exports = {
  PREFIX,
  startCacheCleaner, cleanCache, getCacheSizes,
  checkForUpdates, checkForDiscounts,
  handleStart, handleStop, handleSetCommand,
  handleLatestUpdates, handleLatestDeals, handleLatestSingle,
  handlePriceSearch, handleDlcSearch, handleStatus,
  handleGamesCommand, buildHelpEmbed,
  formatUserError
};
