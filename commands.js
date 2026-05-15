"use strict";
// =============================================================
// commands.js — V8
//   * Slash commands în loc de prefix message-based (eliminăm MessageContent intent)
//   * Currency per-guild propagat în toate path-urile
//   * Round-robin fairness pentru processGuildUpdates (lastProcessedGameKey)
//   * formatPrice peste tot
//   * GLOBAL_CACHE_TTL_MS adaptiv (legat de cron interval)
//   * generateSessionId = 16 hex chars (8 bytes)
// =============================================================
const crypto = require("crypto");
const mongoose = require("mongoose");
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, MessageFlags, PermissionsBitField,
  SlashCommandBuilder, Routes, REST
} = require("discord.js");

const {
  GuildModel, logger, getSystemTimes, saveSystemTimes,
  getGuildSettings, invalidateGuildCache,
  runConcurrent, validatePendingDiscountSnapshot,
  SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, formatPrice,
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
// CONSTANTE
// -------------------------------------------------------------
const CACHE_TTL_MS = 180000;
const CACHE_CLEAN_INTERVAL_MS = 300000;
const ITEMS_PER_PAGE = 5;

const DEALS_HISTORY_LIMIT = env.DEALS_HISTORY_LIMIT;
const SEEN_PER_GAME_LIMIT = env.SEEN_PER_GAME_LIMIT;
const PENDING_UPDATES_PER_GAME_LIMIT = env.PENDING_UPDATES_PER_GAME_LIMIT;
const PENDING_DISCOUNTS_LIMIT = env.PENDING_DISCOUNTS_LIMIT;
const PENDING_UPDATE_MAX_AGE_MS = env.PENDING_UPDATE_MAX_AGE_MS;
const PENDING_DISCOUNT_GRACE_CYCLES = env.PENDING_DISCOUNT_GRACE_CYCLES;
const PENDING_UPDATE_MAX_ATTEMPTS = env.PENDING_UPDATE_MAX_ATTEMPTS;
const PENDING_DISCOUNT_MAX_ATTEMPTS = env.PENDING_DISCOUNT_MAX_ATTEMPTS;
const MAX_UPDATES_PER_CYCLE = env.MAX_UPDATES_PER_CYCLE;
const MAX_DEALS_PER_CYCLE = env.MAX_DEALS_PER_CYCLE;
const DISCORD_SEND_DELAY_MS = env.DISCORD_SEND_DELAY_MS;
const GUILD_PROCESS_CONCURRENCY = env.GUILD_PROCESS_CONCURRENCY;
const MAX_FUZZY_SEARCH_INPUT = env.MAX_FUZZY_SEARCH_INPUT;
const USER_COMMAND_COOLDOWN_MS = env.USER_COMMAND_COOLDOWN_MS;
const COLLECTOR_TIMEOUT_MS = env.COLLECTOR_TIMEOUT_MS;

const DLC_CACHE_MAX_SIZE = 100;
const SINGLE_CACHE_MAX_SIZE = 100;
const DLC_ITEMS_PER_PAGE = 10;
const COMMAND_OUTPUT_MAX_CHARS = 1900;

// V8 (#8): GLOBAL_CACHE_TTL_MS adaptiv. Setat de index.js prin setGlobalCacheTtl.
let GLOBAL_CACHE_TTL_MS = 1800000; // 30min default
function setGlobalCacheTtl(ms) {
  if (Number.isFinite(ms) && ms > 0) {
    GLOBAL_CACHE_TTL_MS = Math.min(ms, 30 * 60 * 1000);
    logger("INFO", "CACHE", `GLOBAL_CACHE_TTL_MS setat la ${GLOBAL_CACHE_TTL_MS}ms`);
  }
}

// -------------------------------------------------------------
// Rate limit per-user
// -------------------------------------------------------------
const USER_COOLDOWNS_THRESHOLD = 500;
const userCommandCooldowns = new Map();

function checkUserCooldown(userId, command) {
  if (USER_COMMAND_COOLDOWN_MS === 0) return { allowed: true };
  const key = `${userId}:${command}`;
  const last = userCommandCooldowns.get(key) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < USER_COMMAND_COOLDOWN_MS) {
    const remainingMs = USER_COMMAND_COOLDOWN_MS - elapsed;
    return { allowed: false, remainingMs };
  }
  userCommandCooldowns.set(key, now);
  if (userCommandCooldowns.size > USER_COOLDOWNS_THRESHOLD) {
    cleanUserCooldowns();
  }
  return { allowed: true };
}

function cleanUserCooldowns() {
  if (USER_COMMAND_COOLDOWN_MS === 0) {
    userCommandCooldowns.clear();
    return;
  }
  const now = Date.now();
  for (const [key, ts] of userCommandCooldowns.entries()) {
    if (now - ts > USER_COMMAND_COOLDOWN_MS * 2) {
      userCommandCooldowns.delete(key);
    }
  }
}

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
// CACHE LOCAL (per-currency pentru deals)
// -------------------------------------------------------------
const cache = {
  updates: { data: null, expiresAt: 0 },
  // V8: deals e per-currency
  dealsByCurrency: new Map(), // "USD" -> { data, expiresAt }
  single: new Map(),
  dlc: new Map()
};

function getDealsCache(currency) {
  return cache.dealsByCurrency.get(currency) || null;
}
function setDealsCache(currency, data) {
  cache.dealsByCurrency.set(currency, { data, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS });
}

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
  for (const [currency, entry] of cache.dealsByCurrency.entries()) {
    if (entry.expiresAt < now) cache.dealsByCurrency.delete(currency);
  }
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
  cleanUserCooldowns();
}

function getCacheSizes() {
  return {
    single: cache.single.size,
    dlc: cache.dlc.size,
    updatesValid: cache.updates.expiresAt > Date.now(),
    dealsCurrenciesValid: cache.dealsByCurrency.size,
    userCooldowns: userCommandCooldowns.size
  };
}

function startCacheCleaner() {
  const handle = setInterval(cleanCache, CACHE_CLEAN_INTERVAL_MS);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

// -------------------------------------------------------------
// UTILE
// -------------------------------------------------------------
function smoothTime(oldMs, newMs, alpha = 0.3) {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}

function formatUserError(err, defaultMsg = "A apărut o eroare internă.", errorCode = null) {
  if (err) {
    const detail = err.stack ? err.stack : (err.message || err);
    logger("WARN", "USER_COMMAND", `${defaultMsg}${errorCode ? ` [${errorCode}]` : ""}`, detail);
  }
  const suffix = errorCode ? ` \`[${errorCode}]\`` : "";
  return `\u274C ${defaultMsg}${suffix}`;
}

function canSendEmbeds(channel, botId) {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return perms && perms.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]);
}

async function sleepIfPositive(ms) {
  if (ms > 0) await new Promise(r => setTimeout(r, ms));
}

function dealPassesFilters(deal, guild) {
  const minDisc = guild?.minDiscountPercent ?? 0;
  const incFree = guild?.includeFreeGames !== false;
  const incPaid = guild?.includePaidDiscounts !== false;
  const isFree = parseFloat(deal.salePrice) === 0;
  if (isFree && !incFree) return false;
  if (!isFree && !incPaid) return false;
  if (!isFree && deal.savings < minDisc) return false;
  return true;
}

// V8: interaction-aware enforceCooldown (acceptă SlashCommandInteraction)
async function enforceCooldown(interaction, command) {
  const userId = interaction.user?.id;
  const { allowed, remainingMs } = checkUserCooldown(userId, command);
  if (!allowed) {
    const remainingSec = Math.ceil(remainingMs / 1000);
    const msg = `\u23F1 Comanda \`${command}\` are cooldown. Reîncearcă în **${remainingSec}s**.`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => null);
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return false;
  }
  return true;
}

function startCommandLog(interaction, command, extra = {}) {
  const startedAt = Date.now();
  logger("INFO", "USER_CMD", `Comandă pornită: ${command}`, {
    userId: interaction.user?.id,
    guildId: interaction.guild?.id,
    channelId: interaction.channel?.id,
    command,
    ...extra
  });
  return (status = "ok", endExtra = {}) => {
    const durationMs = Date.now() - startedAt;
    logger("INFO", "USER_CMD", `Comandă finalizată: ${command} [${status}]`, {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      command, status, durationMs, ...endExtra
    });
  };
}

// -------------------------------------------------------------
// EMBEDS (currency-aware)
// -------------------------------------------------------------
function buildUpdateEmbed(gameName, latest, mode = "detailed") {
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(truncate(latest.title, 256))
    .setFooter({ text: truncate(gameName, 2048) });
  if (latest.link) embed.setURL(latest.link);
  if (isCompact) {
    embed.setDescription(latest.link ? `Apasă pe titlu pentru a citi patch-ul.` : `A apărut un nou update pentru ${gameName}.`);
  } else {
    embed.setDescription(truncate(latest.excerpt || `A apărut un nou update pentru ${gameName}.`, 4096));
    if (latest.image) embed.setImage(latest.image);
    if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
    if (latest.timestamp) {
      const d = new Date(latest.timestamp);
      if (!Number.isNaN(d.getTime())) embed.setTimestamp(d);
    }
  }
  return embed;
}

function buildDealEmbed(deal, mode = "detailed", currency) {
  const cur = currency || deal.currency || DEFAULT_CURRENCY;
  const isFree = parseFloat(deal.salePrice) === 0;
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder()
    .setColor(isFree ? 0xffd700 : 0xe74c3c)
    .setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));
  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~${formatPrice(deal.normalPrice, cur)}~~ -> **${isFree ? "GRATUIT" : formatPrice(deal.salePrice, cur)}**\n[Apasă aici pentru link](${deal.link})`);
  } else {
    let statsStr = "";
    if (deal.qualityScore > 0) {
      statsStr = `\u2B50 **Calitate:** ${deal.qualityScore}% aprecieri | \u{1F465} **Popularitate:** ${deal.totalReviews > 0 ? deal.totalReviews + " recenzii" : "Top Seller"}\n\n`;
    }
    embed.setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(`**${deal.store}** oferă o reducere de **${deal.savings}%**!\n\n`
        + statsStr + (deal.endDateStr !== "Nespecificat" ? `\u23F3 **${isFree ? "Gratis până la" : "Expiră la"}:** ${deal.endDateStr}\n\n` : ""), 4096))
      .addFields(
        { name: "Preț Vechi", value: `~~${formatPrice(deal.normalPrice, cur)}~~`, inline: true },
        { name: "Preț Nou", value: isFree ? "\u{1F525} GRATUIT \u{1F525}" : formatPrice(deal.salePrice, cur), inline: true },
        { name: "Link", value: `[Apasă aici](${deal.link})`, inline: false }
      );
    if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
    if (deal.extraDetails) embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails.trim(), 1024), inline: false });
  }
  return embed;
}

// -------------------------------------------------------------
// PAGINATION
// -------------------------------------------------------------
// V8 (#12): 8 bytes = 16 hex chars (practic collision-free)
function generateSessionId() {
  return crypto.randomBytes(8).toString("hex");
}

function buildPaginationButtons(prefix, sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("\u2B05 Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm \u27A1").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(interactionMessage, authorId, prefix, items, itemsPerPage, generateEmbedsFn, defaultMode = "detailed") {
  if (!items || items.length === 0) return;
  let currentPage = 0;
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = generateSessionId();
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
  collector = interactionMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS
  });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) return btn.reply({ content: "Doar autorul comenzii poate naviga!", flags: MessageFlags.Ephemeral }).catch(() => null);
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

// -------------------------------------------------------------
// GAME RESOLVER
// -------------------------------------------------------------
function findGameAndSuggestion(text, games) {
  let search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length > MAX_FUZZY_SEARCH_INPUT) {
    search = search.substring(0, MAX_FUZZY_SEARCH_INPUT);
  }

  if (search.length < 2) {
    const exact = games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }

  const candidates = [];
  for (const game of games) {
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
// STATUS
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

  const embed = new EmbedBuilder().setColor(color).setTitle(`\u{1F4E1} Status Servere: ${game.name}`).setDescription(statusText);
  if (statusLink && statusLink.startsWith("http")) {
    embed.addFields({ name: "\u{1F517} Pagină Oficială de Status", value: `[Verifică Statusul Aici](${statusLink})` });
  } else if (homepageLink && homepageLink.startsWith("http")) {
    embed.addFields({ name: "\u{1F3E0} Pagină Principală / Fallback", value: `[Accesează Homepage](${homepageLink})\n*(Acesta este link-ul general al jocului/producătorului, nu o pagină automată de status)*` });
  }
  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}

function buildSteamPriceEmbed(gameData, appId, offerEndDate, currency) {
  const cur = currency || DEFAULT_CURRENCY;
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
    embedDesc += `Prețul nu este disponibil în acest moment.`;
  } else {
    const normalPrice = (priceOverview.initial / 100).toFixed(2);
    const currentPrice = (priceOverview.final / 100).toFixed(2);
    const discountPercent = priceOverview.discount_percent;
    if (discountPercent > 0) {
      embedDesc += `Este o reducere activă de **${discountPercent}%**!\n\n~~${formatPrice(normalPrice, cur)}~~ -> **${formatPrice(currentPrice, cur)}**`;
      color = 0xe74c3c;
      if (offerEndDate) embedDesc += `\n\u23F3 **Oferta expiră la:** ${offerEndDate}`;
      else embedDesc += `\n\u23F3 **Oferta expiră la:** Nespecificat (posibil ofertă permanentă sau bundle).`;
    } else {
      embedDesc += `Nu este la reducere în acest moment.\n\nPreț standard: **${formatPrice(normalPrice, cur)}**`;
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

// V8 (#3): round-robin fairness. Începem iterarea de la game-ul de după
// lastProcessedGameKey, ca să nu starvăm jocurile de la coada listei.
function rotatePendingEntries(entries, lastKey) {
  if (!lastKey || entries.length === 0) return entries;
  const idx = entries.findIndex(([k]) => k === lastKey);
  if (idx < 0) return entries;
  // începem de la idx+1 (după ultimul procesat)
  return entries.slice(idx + 1).concat(entries.slice(0, idx + 1));
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

  // V8 (#3): aplicăm round-robin pe ordinea de procesare
  const allEntries = Array.from(pendingByGame.entries());
  const rotatedEntries = rotatePendingEntries(allEntries, guild.lastProcessedGameKey);
  let lastProcessedKey = guild.lastProcessedGameKey || null;

  for (const [gk, queue] of rotatedEntries) {
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
          guildId: guild._id, gameKey: gk, updateId: next.id,
          messageId: sentMessage?.id || null
        });
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
        remaining.shift();
        sentCount++;
        lastProcessedKey = gk; // V8 (#3): tracking pentru round-robin
        updatedSeenOps[`seen.${gk}`] = updatedSeenOps[`seen.${gk}`] || { $each: [], $slice: -SEEN_PER_GAME_LIMIT };
        updatedSeenOps[`seen.${gk}`].$each.push(next.id);
      } catch (err) {
        logger("WARN", "CRON_UPDATES", `Eroare la trimitere pe canal ${channel.id}`, err.message);
        next.attempts = (next.attempts || 0) + 1;
        if (next.attempts >= PENDING_UPDATE_MAX_ATTEMPTS) {
          logger("WARN", "CRON_UPDATES", `Renunț la pending după ${next.attempts} încercări`, { gameKey: gk, id: next.id });
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
      for (const [otherGk, otherQueue] of rotatedEntries) {
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
  // V8 (#3): persist lastProcessedGameKey
  if (lastProcessedKey && lastProcessedKey !== guild.lastProcessedGameKey) {
    $set.lastProcessedGameKey = lastProcessedKey;
  }
  if (Object.keys($set).length > 0) updateDoc.$set = $set;
  if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;
  if (Object.keys(updateDoc).length > 0) {
    try {
      const result = await GuildModel.updateOne(
        { _id: guild._id, subscribed: true, notificationChannelId: guild.notificationChannelId },
        updateDoc
      );
      if (result.matchedCount === 0) {
        logger("INFO", "CRON_UPDATES", "Guild state schimbat între citire și write — skip persistență", {
          guildId: guild._id, sentInCycle: Object.keys(updatedSeenOps).length
        });
      }
      invalidateGuildCache(guild._id);
    } catch (err) {
      logger("ERROR", "CRON_UPDATES", `DB updateOne eșuat după trimitere — risc duplicat la următorul ciclu`, {
        guildId: guild._id, sentInCycle: Object.keys(updatedSeenOps).length, error: err.message
      });
    }
  }
}

async function checkForUpdates(client, games, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  if (mongoose.connection.readyState !== 1) {
    return logger("WARN", "CRON_UPDATES", "Mongo nu e conectat, sar peste checkForUpdates");
  }

  const guilds = await GuildModel.find({ subscribed: true, notificationChannelId: { $ne: null } }).lean();
  if (!guilds.length) return;

  const results = await getLatestForAllGames(games, shouldAbort);
  const validResults = results.filter(r => r.latest !== null);
  if (!validResults.length) return;

  const result = await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
    await processGuildUpdates(client, guild, validResults, shouldAbort);
  }, {
    shouldAbort,
    errorLogger: (guild, err) => {
      logger("WARN", "CRON_UPDATES", `Eroare procesare guild ${guild._id}`, err.message);
    }
  });

  if (guilds.length >= 3 && result.errors.length >= Math.ceil(guilds.length / 2)) {
    logger("ERROR", "CRON_UPDATES", "Rată mare de erori la procesarea guild-urilor", {
      total: guilds.length, errors: result.errors.length, processed: result.processed
    });
    const { adminAlert } = require("./db");
    adminAlert("cron:updates-error-rate",
      "Cron updates: rată mare de erori",
      `${result.errors.length}/${guilds.length} guild-uri au eșuat la procesare în acest ciclu.`
    ).catch(() => null);
  }
}

// -------------------------------------------------------------
// CRON: checkForDiscounts (currency-aware)
// V8: grupăm guild-urile pe currency pentru a deduplica fetch-ul.
// -------------------------------------------------------------
async function processGuildDiscounts(client, guild, deals, dealsByHash, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  let channel;
  try { channel = await client.channels.fetch(guild.discountChannelId); }
  catch { return; }
  if (!canSendEmbeds(channel, client.user.id)) return;

  const currency = guild.currency || DEFAULT_CURRENCY;

  const seenSet = new Set(guild.seenDiscounts || []);
  const oldPending = normalizePendingDiscountArray(guild.pendingDiscounts);

  const queue = [];
  const inQueueHashes = new Set();

  for (const p of oldPending) {
    const fresh = dealsByHash.get(p.hash);
    if (fresh) {
      const carriedAttempts = p.attempts || 0;
      if (carriedAttempts >= PENDING_DISCOUNT_MAX_ATTEMPTS) {
        logger("WARN", "CRON_DISCOUNTS", `Renunț la pending discount după ${carriedAttempts} încercări`, {
          guildId: guild._id, hash: p.hash
        });
        continue;
      }
      queue.push({
        hash: p.hash, snapshot: fresh, attempts: carriedAttempts, lastSeenAt: new Date()
      });
      inQueueHashes.add(p.hash);
    } else {
      const newAttempts = (p.attempts || 0) + 1;
      if (newAttempts < PENDING_DISCOUNT_GRACE_CYCLES && validatePendingDiscountSnapshot(p.snapshot)) {
        if (dealPassesFilters(p.snapshot, guild)) {
          queue.push({
            hash: p.hash, snapshot: p.snapshot, attempts: newAttempts,
            lastSeenAt: p.lastSeenAt || new Date()
          });
          inQueueHashes.add(p.hash);
        }
      } else if (newAttempts < PENDING_DISCOUNT_GRACE_CYCLES) {
        logger("WARN", "CRON_DISCOUNTS", `Snapshot pending discount invalid — dropping`, {
          guildId: guild._id, hash: p.hash
        });
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
    let dealToSend = deal;
    try { dealToSend = await enrichDealData(deal, currency); } catch { /* fail-soft */ }

    const embed = buildDealEmbed(dealToSend, guild.notificationMode || "detailed", currency);
    try {
      const sentMessage = await channel.send({ content: `\u{1F525} Ofertă nouă detectată!`, embeds: [embed] });
      logger("INFO", "CRON_DISCOUNTS_SENT", "Ofertă trimisă", {
        guildId: guild._id, hash: entry.hash, title: deal.title,
        messageId: sentMessage?.id || null
      });
      await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      sentHashes.push(entry.hash);
      sentCount++;
    } catch (err) {
      logger("WARN", "CRON_DISCOUNTS", `Eroare trimitere oferte canal ${channel.id}`, err.message);
      const newAttempts = (entry.attempts || 0) + 1;
      if (newAttempts < PENDING_DISCOUNT_MAX_ATTEMPTS) {
        entry.attempts = newAttempts;
        remainingQueue.push(entry);
      } else {
        logger("WARN", "CRON_DISCOUNTS", `Renunț definitiv după ${newAttempts} încercări de trimitere`, {
          guildId: guild._id, hash: entry.hash
        });
      }
    }
  }

  const finalPending = remainingQueue.slice(-PENDING_DISCOUNTS_LIMIT);
  const updateDoc = {};
  if (sentHashes.length > 0) {
    updateDoc.$push = { seenDiscounts: { $each: sentHashes, $slice: -DEALS_HISTORY_LIMIT } };
  }
  updateDoc.$set = { pendingDiscounts: finalPending };

  try {
    const result = await GuildModel.updateOne(
      { _id: guild._id, discountsSubscribed: true, discountChannelId: guild.discountChannelId },
      updateDoc
    );
    if (result.matchedCount === 0) {
      logger("INFO", "CRON_DISCOUNTS", "Guild state schimbat între citire și write — skip persistență", {
        guildId: guild._id, sentInCycle: sentHashes.length
      });
    }
    invalidateGuildCache(guild._id);
  } catch (err) {
    logger("ERROR", "CRON_DISCOUNTS", `DB updateOne eșuat după trimitere — risc duplicat la următorul ciclu`, {
      guildId: guild._id, sentInCycle: sentHashes.length, error: err.message
    });
  }
}

async function checkForDiscounts(client, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  if (mongoose.connection.readyState !== 1) {
    return logger("WARN", "CRON_DISCOUNTS", "Mongo nu e conectat, sar peste checkForDiscounts");
  }

  const guilds = await GuildModel.find({
    discountsSubscribed: true,
    discountChannelId: { $ne: null }
  }).lean();
  if (!guilds.length) return;

  // V8: grupăm guild-urile pe currency și fetch-uim deals separat per currency.
  const guildsByCurrency = new Map();
  for (const g of guilds) {
    const cur = g.currency || DEFAULT_CURRENCY;
    if (!guildsByCurrency.has(cur)) guildsByCurrency.set(cur, []);
    guildsByCurrency.get(cur).push(g);
  }

  const dealsByCurrency = new Map(); // currency -> { deals, dealsByHash }
  for (const [currency, _guilds] of guildsByCurrency.entries()) {
    try {
      const deals = await fetchDeals({ fromCron: true, currency });
      const byHash = new Map();
      for (const d of deals) byHash.set(dealHash(d), d);
      dealsByCurrency.set(currency, { deals, dealsByHash: byHash });
    } catch (err) {
      logger("WARN", "CRON_DISCOUNTS", `Eroare fetch oferte cron (currency=${currency})`, err.message);
    }
  }

  const result = await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
    const cur = guild.currency || DEFAULT_CURRENCY;
    const bucket = dealsByCurrency.get(cur);
    if (!bucket) return; // fetch a eșuat pentru currency-ul ăsta
    await processGuildDiscounts(client, guild, bucket.deals, bucket.dealsByHash, shouldAbort);
  }, {
    shouldAbort,
    errorLogger: (guild, err) => {
      logger("WARN", "CRON_DISCOUNTS", `Eroare procesare guild ${guild._id}`, err.message);
    }
  });

  if (guilds.length >= 3 && result.errors.length >= Math.ceil(guilds.length / 2)) {
    logger("ERROR", "CRON_DISCOUNTS", "Rată mare de erori la procesarea guild-urilor", {
      total: guilds.length, errors: result.errors.length, processed: result.processed
    });
    const { adminAlert } = require("./db");
    adminAlert("cron:discounts-error-rate",
      "Cron discounts: rată mare de erori",
      `${result.errors.length}/${guilds.length} guild-uri au eșuat la procesare în acest ciclu.`
    ).catch(() => null);
  }
}

// =============================================================
// SLASH COMMANDS DEFINITION
// =============================================================
const CURRENCY_CHOICES = Object.keys(SUPPORTED_CURRENCIES).map(c => ({ name: c, value: c }));

function buildSlashCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Verifică dacă botul răspunde"),

    new SlashCommandBuilder()
      .setName("games")
      .setDescription("Listează jocurile urmărite (poreclele acceptate)"),

    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Afișează meniul de ajutor"),

    new SlashCommandBuilder()
      .setName("start")
      .setDescription("Pornește notificările automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(s => s.setName("updates").setDescription("Pornește update-urile pe acest canal"))
      .addSubcommand(s => s.setName("reduceri").setDescription("Pornește alertele de reduceri pe acest canal")),

    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Oprește notificările automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(s => s.setName("updates").setDescription("Oprește update-urile"))
      .addSubcommand(s => s.setName("reduceri").setDescription("Oprește alertele de reduceri")),

    new SlashCommandBuilder()
      .setName("set")
      .setDescription("Configurează preferințele serverului (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(s => s.setName("mode").setDescription("Mod afișare embed")
        .addStringOption(o => o.setName("value").setDescription("compact sau detailed").setRequired(true)
          .addChoices({ name: "compact", value: "compact" }, { name: "detailed", value: "detailed" })))
      .addSubcommand(s => s.setName("mindiscount").setDescription("Procent minim reducere (0-100)")
        .addIntegerOption(o => o.setName("value").setDescription("0-100").setRequired(true).setMinValue(0).setMaxValue(100)))
      .addSubcommand(s => s.setName("free").setDescription("Afișează jocurile gratuite?")
        .addStringOption(o => o.setName("value").setDescription("on/off").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand(s => s.setName("paid").setDescription("Afișează ofertele plătite?")
        .addStringOption(o => o.setName("value").setDescription("on/off").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand(s => s.setName("currency").setDescription("Valuta pentru afișarea prețurilor")
        .addStringOption(o => o.setName("value").setDescription("USD/EUR/GBP/RON").setRequired(true)
          .addChoices(...CURRENCY_CHOICES))),

    new SlashCommandBuilder()
      .setName("latest")
      .setDescription("Comenzi pentru ultimele update-uri/oferte")
      .addSubcommand(s => s.setName("updates").setDescription("Cele mai recente update-uri pentru toate jocurile"))
      .addSubcommand(s => s.setName("reduceri").setDescription("Cele mai bune reduceri actuale"))
      .addSubcommand(s => s.setName("update").setDescription("Ultimul update pentru un joc specific")
        .addStringOption(o => o.setName("joc").setDescription("Numele/porecla jocului").setRequired(true)))
      .addSubcommand(s => s.setName("pret").setDescription("Caută prețul curent pe Steam")
        .addStringOption(o => o.setName("joc").setDescription("Numele jocului").setRequired(true))),

    new SlashCommandBuilder()
      .setName("dlc")
      .setDescription("Caută DLC-urile pentru un joc pe Steam")
      .addStringOption(o => o.setName("joc").setDescription("Numele jocului").setRequired(true)),

    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Verifică status server pentru un joc")
      .addStringOption(o => o.setName("joc").setDescription("Numele/porecla jocului").setRequired(true))
  ].map(b => b.toJSON());
}

async function registerSlashCommands(token, clientId) {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = buildSlashCommandDefinitions();
  await rest.put(Routes.applicationCommands(clientId), { body });
  logger("INFO", "SLASH", `Înregistrate ${body.length} slash commands global.`);
}

// =============================================================
// HANDLERS (interaction-based)
// =============================================================

// V8: helper pentru deferReply + safe followUp
async function safeDefer(interaction, ephemeral = false) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }
  } catch (e) {
    logger("WARN", "INTERACTION", "Eroare la deferReply", e.message);
  }
}

async function safeEdit(interaction, payload) {
  try { return await interaction.editReply(payload); }
  catch (e) {
    logger("WARN", "INTERACTION", "Eroare la editReply", e.message);
    return null;
  }
}

async function handlePingInteraction(interaction) {
  return interaction.reply("Pong! \u{1F4CD}");
}

async function handleGamesInteraction(interaction, games) {
  const lines = games.map(g => {
    let item = `- **${g.name}** (\`${g.key}\`)`;
    if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
    return item;
  });
  let currentMsg = "\u{1F3AE} **Jocuri urmărite:**\n";
  const messages = [];
  for (const line of lines) {
    if (currentMsg.length + line.length > COMMAND_OUTPUT_MAX_CHARS) {
      messages.push(currentMsg);
      currentMsg = "";
    }
    currentMsg += line + "\n";
  }
  if (currentMsg.trim() !== "") messages.push(currentMsg);

  if (messages.length === 0) return interaction.reply("Nu sunt jocuri configurate.");
  await interaction.reply(messages[0]);
  for (let i = 1; i < messages.length; i++) {
    await interaction.followUp(messages[i]).catch(() => null);
  }
}

async function handleHelpInteraction(interaction) {
  return interaction.reply({ embeds: [buildHelpEmbed()] });
}

async function handleStartInteraction(interaction, games) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  await safeDefer(interaction);

  if (sub === "updates") {
    try {
      const results = await getLatestForAllGames(games);
      const seenPayload = {
        notificationChannelId: interaction.channel.id,
        pendingUpdates: {}
      };
      for (const r of results) {
        if (r.latest) seenPayload[`seen.${r.game.key}`] = [r.latest.id];
      }
      await GuildModel.updateOne({ _id: guildId }, { $set: seenPayload }, { upsert: true });

      const result = await GuildModel.updateOne(
        { _id: guildId, notificationChannelId: { $ne: null } },
        { $set: { subscribed: true } }
      );

      invalidateGuildCache(guildId);
      if (result.matchedCount === 0) {
        return safeEdit(interaction, "\u26A0\uFE0F Activarea a fost întreruptă (probabil de o comandă `stop` concurentă). Te rog reia comanda.");
      }
      return safeEdit(interaction, "\u2705 Update-uri automate activate.");
    } catch (err) {
      return safeEdit(interaction, formatUserError(err, "Eroare la inițializarea datelor."));
    }
  }

  if (sub === "reduceri") {
    try {
      const guild = await getGuildSettings(guildId);
      const currency = guild?.currency || DEFAULT_CURRENCY;
      const deals = await fetchDeals({ currency });
      const initHashes = deals.map(d => dealHash(d)).slice(0, DEALS_HISTORY_LIMIT);

      await GuildModel.updateOne(
        { _id: guildId },
        { $set: {
            discountChannelId: interaction.channel.id,
            seenDiscounts: initHashes,
            pendingDiscounts: []
        }},
        { upsert: true }
      );
      const result = await GuildModel.updateOne(
        { _id: guildId, discountChannelId: { $ne: null } },
        { $set: { discountsSubscribed: true } }
      );

      invalidateGuildCache(guildId);
      if (result.matchedCount === 0) {
        return safeEdit(interaction, "\u26A0\uFE0F Activarea reducerilor a fost întreruptă (probabil de o comandă `stop` concurentă). Te rog reia comanda.");
      }
      return safeEdit(interaction, "\u2705 Alertele reduceri activate!");
    } catch (err) {
      return safeEdit(interaction, formatUserError(err, "Eroare internă la preluarea ofertelor."));
    }
  }
}

async function handleStopInteraction(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  await safeDefer(interaction);

  try {
    if (sub === "updates") {
      await GuildModel.updateOne({ _id: guildId }, {
        $set: { subscribed: false, notificationChannelId: null, pendingUpdates: {} }
      });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "\u{1F6D1} Update-uri oprite.");
    }
    if (sub === "reduceri") {
      await GuildModel.updateOne({ _id: guildId }, {
        $set: { discountsSubscribed: false, discountChannelId: null, pendingDiscounts: [] }
      });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "\u{1F6D1} Reduceri oprite.");
    }
  } catch (err) {
    return safeEdit(interaction, formatUserError(err, "Eroare la baza de date."));
  }
}

async function handleSetInteraction(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  await safeDefer(interaction);

  const updateDoc = {};
  let confirmMsg = "";
  let isFilterChange = false;

  if (sub === "mode") {
    const value = interaction.options.getString("value");
    updateDoc.notificationMode = value;
    confirmMsg = `\u2705 Mod setat: **${value}**`;
  } else if (sub === "mindiscount") {
    const min = interaction.options.getInteger("value");
    updateDoc.minDiscountPercent = min;
    confirmMsg = `\u2705 Reducere minimă: **${min}%**`;
    isFilterChange = true;
  } else if (sub === "free") {
    const value = interaction.options.getString("value");
    updateDoc.includeFreeGames = value === "on";
    confirmMsg = `\u2705 Jocuri free: **${value.toUpperCase()}**`;
    isFilterChange = true;
  } else if (sub === "paid") {
    const value = interaction.options.getString("value");
    updateDoc.includePaidDiscounts = value === "on";
    confirmMsg = `\u2705 Oferte plătite: **${value.toUpperCase()}**`;
    isFilterChange = true;
  } else if (sub === "currency") {
    const value = interaction.options.getString("value");
    updateDoc.currency = value;
    confirmMsg = `\u2705 Valuta setată: **${value}**`;
    isFilterChange = true; // re-fetch cu cc nou
  }

  if (isFilterChange) updateDoc.pendingDiscounts = [];
  try {
    await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, confirmMsg + (isFilterChange ? " *(coada de pending a fost resetată)*" : ""));
  } catch (err) {
    return safeEdit(interaction, formatUserError(err, "Eroare la salvarea preferințelor."));
  }
}

async function handleLatestInteraction(interaction, games) {
  const sub = interaction.options.getSubcommand();
  if (sub === "updates") return handleLatestUpdatesInteraction(interaction, games);
  if (sub === "reduceri") return handleLatestDealsInteraction(interaction);
  if (sub === "update") {
    const joc = interaction.options.getString("joc");
    return handleLatestSingleInteraction(interaction, joc, games);
  }
  if (sub === "pret") {
    const joc = interaction.options.getString("joc");
    return handlePriceSearchInteraction(interaction, joc);
  }
}

async function handleLatestUpdatesInteraction(interaction, games) {
  if (!(await enforceCooldown(interaction, "latest updates"))) return;
  const endLog = startCommandLog(interaction, "latest updates");
  await safeDefer(interaction);

  if (!cache.updates.data) {
    const estMs = (await getSystemTimes()).all || 35000;
    await safeEdit(interaction, `\u23F3 *Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
      const results = await getLatestForAllGames(games);
      cache.updates = { data: results, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
      const sys = await getSystemTimes();
      sys.all = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    } catch (err) {
      endLog("error", { errorMsg: err.message });
      return safeEdit(interaction, formatUserError(err, "Nu am reușit să obțin update-urile.", "ERR_LATEST_UPDATES"));
    }
  }
  const valid = cache.updates.data.filter(r => r.latest !== null);
  if (!valid.length) {
    endLog("no_data");
    return safeEdit(interaction, "\u274C Nu am date disponibile.");
  }
  const guild = await getGuildSettings(interaction.guild.id);
  const mode = guild?.notificationMode || "detailed";
  const msg = await safeEdit(interaction, "\u2705 Date încărcate!");

  const generateEmbeds = async (page, totalP, currentMode) =>
    valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r =>
      buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} • Pagina ${page + 1}/${totalP}` })
    );
  endLog("ok", { resultCount: valid.length });
  if (msg) await handlePagination(msg, interaction.user.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestDealsInteraction(interaction) {
  if (!(await enforceCooldown(interaction, "latest reduceri"))) return;
  const endLog = startCommandLog(interaction, "latest reduceri");
  await safeDefer(interaction);

  const guild = await getGuildSettings(interaction.guild.id);
  const currency = guild?.currency || DEFAULT_CURRENCY;
  const mode = guild?.notificationMode || "detailed";

  const cachedDeals = getDealsCache(currency);
  if (!cachedDeals) {
    const estMs = (await getSystemTimes()).reduceri || 10000;
    await safeEdit(interaction, `\u23F3 *Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
      const rawDeals = await fetchDeals({ currency });
      setDealsCache(currency, rawDeals);
      const sys = await getSystemTimes();
      sys.reduceri = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    } catch (err) {
      endLog("error", { errorMsg: err.message });
      return safeEdit(interaction, formatUserError(err, "Nu am putut interoga magazinele.", "ERR_LATEST_DEALS"));
    }
  }
  const deals = getDealsCache(currency).data;
  const top = deals.filter(d => dealPassesFilters(d, guild)).slice(0, MAX_DEALS);

  if (!top.length) {
    endLog("no_data");
    return safeEdit(interaction, "\u274C Nu am găsit oferte care să corespundă setărilor serverului.");
  }
  const msg = await safeEdit(interaction, "\u2705 Oferte încărcate!");

  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    const dealsToRender = [];
    for (const d of chunk) {
      if (currentMode !== "compact") {
        try { dealsToRender.push(await enrichDealData(d, currency)); }
        catch (e) {
          logger("WARN", "ENRICH", "Eroare enrich command handler", e.message);
          dealsToRender.push(d);
        }
      } else {
        dealsToRender.push(d);
      }
    }
    return dealsToRender.map(d => buildDealEmbed(d, currentMode, currency).setFooter({ text: `Pagina ${page + 1}/${totalP}` }));
  };
  endLog("ok", { resultCount: top.length });
  if (msg) await handlePagination(msg, interaction.user.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestSingleInteraction(interaction, gameText, games) {
  if (!gameText) return interaction.reply({ content: "\u274C Trebuie să specifici un joc.", flags: MessageFlags.Ephemeral });
  const endLog = startCommandLog(interaction, "latest update", { query: gameText });
  await safeDefer(interaction);

  const estMs = (await getSystemTimes()).single || 2000;
  await safeEdit(interaction, `\u23F3 *Mă conectez... Durată estimată: **${Math.max(1, Math.ceil(estMs / 1000))} secunde**.*`);
  const startTime = Date.now();

  const { game, suggestion } = findGameAndSuggestion(gameText, games);
  if (!game) {
    endLog("not_found", { suggestion: suggestion?.key });
    let errText = `\u274C Nu am găsit jocul.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
    return safeEdit(interaction, errText);
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
    const guild = await getGuildSettings(interaction.guild.id);
    endLog("ok", { gameKey: game.key });
    return safeEdit(interaction, {
      content: `\u2705 Update **${game.name}**:`,
      embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")]
    });
  } catch (error) {
    endLog("error", { gameKey: game.key, errorMsg: error.message });
    return safeEdit(interaction, formatUserError(error, "Nu am putut prelua acest update.", "ERR_LATEST_SINGLE"));
  }
}

async function handlePriceSearchInteraction(interaction, gameName) {
  if (!gameName) return interaction.reply({ content: "\u274C Trebuie să specifici un joc.", flags: MessageFlags.Ephemeral });
  if (!(await enforceCooldown(interaction, "latest pret"))) return;
  const endLog = startCommandLog(interaction, "latest pret", { query: gameName });
  await safeDefer(interaction);

  const guild = await getGuildSettings(interaction.guild.id);
  const currency = guild?.currency || DEFAULT_CURRENCY;

  await safeEdit(interaction, `\u23F3 *Caut prețul pe Steam pentru **${gameName}**...*`);
  try {
    let items;
    try { items = await searchSteamGameByName(gameName, currency); }
    catch (e) {
      endLog("error", { stage: "search", errorMsg: e.message });
      return safeEdit(interaction, `\u274C Eroare la conectarea cu serverele Steam. Te rugăm să încerci mai târziu. \`[ERR_STEAM_CONN]\``);
    }
    if (!items || items.length === 0) {
      endLog("not_found");
      logger("WARN", "PRICE_SEARCH", `Joc negăsit pe Steam pentru query-ul: ${gameName}`);
      return safeEdit(interaction, `\u274C Nu am găsit niciun rezultat pe Steam pentru "**${gameName}**".`);
    }
    const bestMatch = chooseBestSteamMatch(items, gameName, { forceGameOnly: true });
    if (!bestMatch || !bestMatch.id) {
      endLog("no_match");
      return safeEdit(interaction, `\u274C Nu am putut selecta un rezultat valid de pe Steam.`);
    }
    const bestMatchId = bestMatch.id;
    logger("INFO", "PRICE_SEARCH", `Pentru "${gameName}" am selectat ID: ${bestMatchId} (Nume: ${bestMatch.name})`);

    let gameData;
    try { gameData = await fetchSteamPriceDetails(bestMatchId, currency); }
    catch (e) {
      endLog("error", { stage: "details", errorMsg: e.message });
      return safeEdit(interaction, `\u274C Steam API nu a putut returna detaliile pentru acest titlu. \`[ERR_STEAM_DETAILS]\``);
    }
    if (!gameData) {
      endLog("no_details", { appId: bestMatchId });
      return safeEdit(interaction, `\u274C Am găsit un rezultat, dar detaliile de preț nu sunt disponibile (posibil blocat regional sau nelistat).`);
    }

    let offerEndDate = null;
    if (gameData.price_overview && gameData.price_overview.discount_percent > 0) {
      offerEndDate = await extractSteamOfferEndDate(bestMatchId);
    }
    const embed = buildSteamPriceEmbed(gameData, bestMatchId, offerEndDate, currency);
    endLog("ok", { appId: bestMatchId });
    return safeEdit(interaction, { content: "\u2705 Am obținut datele de pe Steam!", embeds: [embed] });
  } catch (err) {
    endLog("error", { stage: "general", errorMsg: err.message });
    logger("ERROR", "PRICE_SEARCH", "Eroare finală nespecificată la căutare preț", err.message);
    return safeEdit(interaction, `\u274C A apărut o eroare neașteptată la căutarea prețului. \`[ERR_PRICE_GENERAL]\``);
  }
}

async function handleDlcInteraction(interaction) {
  const gameName = interaction.options.getString("joc");
  if (!(await enforceCooldown(interaction, "dlc"))) return;
  const endLog = startCommandLog(interaction, "dlc", { query: gameName });
  await safeDefer(interaction);

  const guild = await getGuildSettings(interaction.guild.id);
  const currency = guild?.currency || DEFAULT_CURRENCY;
  await safeEdit(interaction, `\u23F3 *Caut DLC-urile pentru **${gameName}**...*`);

  try {
    let items;
    try { items = await searchSteamGameByName(gameName, currency); }
    catch (e) {
      endLog("error", { stage: "search", errorMsg: e.message });
      return safeEdit(interaction, `\u274C Eroare la conectarea cu serverele Steam. \`[ERR_STEAM_CONN]\``);
    }
    if (!items || items.length === 0) {
      endLog("not_found");
      return safeEdit(interaction, `\u274C Nu am găsit niciun rezultat pe Steam pentru "**${gameName}**".`);
    }
    let bestMatch = chooseBestSteamMatch(items, gameName, { forceGameOnly: true });
    if (!bestMatch || !bestMatch.id) {
      endLog("no_match");
      return safeEdit(interaction, `\u274C Nu am putut selecta un joc valid de pe Steam.`);
    }
    if (String(bestMatch.type || "").toLowerCase() !== "game") {
      const baseGame = items.find(item => typeof item.type === "string" && item.type.toLowerCase() === "game");
      if (baseGame) {
        bestMatch = baseGame;
        logger("INFO", "DLC_SEARCH", `Fallback la joc de bază pentru query: ${gameName}`);
      }
    }

    const cacheKey = `${bestMatch.id}:${currency}`;
    let dlcData = cacheGetLRU(cache.dlc, cacheKey);
    if (dlcData === null) {
      const title = bestMatch.name;
      let gameDetails;
      try { gameDetails = await fetchSteamPriceDetails(bestMatch.id, currency); }
      catch (e) { logger("WARN", "DLC_SEARCH", `Nu am putut prelua header_image pentru ${bestMatch.id}`); }
      const thumbUrl = gameDetails?.header_image
        || `https://cdn.akamai.steamstatic.com/steam/apps/${bestMatch.id}/header.jpg`;

      const { getCurrencyConfig } = require("./db");
      const cc = getCurrencyConfig(currency).cc;
      const htmlRes = await httpReq("GET", `https://store.steampowered.com/app/${bestMatch.id}?cc=${cc}`, {
        headers: { "Cookie": "birthtime=283993201; mature_content=1;" },
        timeout: 15000
      });
      const $ = safeCheerioLoad(htmlRes.data);
      if ($("#agegate_box").length > 0 || $(".agegate_text_container").length > 0
          || htmlRes.request?.path?.includes("agecheck")) {
        endLog("age_gate", { appId: bestMatch.id });
        return safeEdit(interaction, `\u274C Pagina de Steam pentru **${title}** necesită verificare de vârstă, iar botul nu o poate accesa direct.`);
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
          // V8 (#4): drift detection — pagina e fetch-uită OK dar nu putem
          // parsa nici DLC-urile, nici containerul principal de purchase.
          // Log explicit drift, dar nu activăm circuit breaker (e comandă manuală).
          logger("WARN", "DLC_SEARCH", "Schema drift suspectat (DLC pagină nu poate fi parsată)",
            { appId: bestMatch.id, query: gameName });
          endLog("parse_error", { appId: bestMatch.id });
          return safeEdit(interaction, `\u274C Structura paginii pentru **${title}** nu a putut fi interpretată (posibil regiune blocată, pachet special sau schimbare la Steam).`);
        }
        endLog("no_dlc", { appId: bestMatch.id });
        return safeEdit(interaction, `\u274C Jocul **${title}** nu are niciun DLC listat separat pe magazinul Steam.`);
      }
      const totalExtracted = dlcList.length;
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: bestMatch.id, thumbUrl, totalExtracted };
      cacheSetLRU(cache.dlc, cacheKey, dlcData, CACHE_TTL_MS, DLC_CACHE_MAX_SIZE);
    }

    const { dlcList, title, appId: finalAppId, thumbUrl: finalThumbUrl, totalExtracted } = dlcData;
    const msg = await safeEdit(interaction, `\u2705 Am găsit **${totalExtracted}** DLC-uri pentru **${title}**!`);

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
      embed.setFooter({ text: `Pagina ${page + 1}/${totalP} • Afișate: ${dlcList.length} / Extrase: ${totalExtracted}` });
      return [embed];
    };
    endLog("ok", { appId: finalAppId, dlcCount: totalExtracted });
    if (msg) await handlePagination(msg, interaction.user.id, "dlc_cmd", dlcList, itemsPerPage, generateEmbeds, "detailed");
  } catch (err) {
    endLog("error", { stage: "general", errorMsg: err.message });
    logger("ERROR", "DLC_SEARCH", "Eroare la extragere DLC-uri", err.message);
    return safeEdit(interaction, `\u274C A apărut o eroare la căutarea DLC-urilor. \`[ERR_DLC_GENERAL]\``);
  }
}

async function handleStatusInteraction(interaction, games) {
  const gameText = interaction.options.getString("joc");
  await safeDefer(interaction);
  await safeEdit(interaction, `\u23F3 *Verific statusul serverelor pentru **${gameText}**...*`);

  const { game, suggestion } = findGameAndSuggestion(gameText, games);
  if (!game) {
    let errText = `\u274C Nu am găsit jocul în baza mea de date.`;
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
    return safeEdit(interaction, errText);
  }
  try {
    const embed = await fetchGameStatus(game);
    return safeEdit(interaction, {
      content: `\u2705 Informații preluate pentru **${game.name}**:`,
      embeds: [embed]
    });
  } catch (err) {
    logger("ERROR", "STATUS", "Eroare la comanda status", err.message);
    return safeEdit(interaction, `\u274C A apărut o eroare la preluarea statusului. \`[ERR_STATUS_GENERAL]\``);
  }
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("\u{1F916} Meniul de Ajutor - Big Master")
    .setDescription("Toate comenzile sunt slash commands. Începe cu `/` pentru autocomplete.")
    .addFields(
      { name: "\u{1F6E0} Utilitare",
        value: "`/ping` • `/games` • `/help`" },
      { name: "\u{1F514} Notificări Automate (admin)",
        value: "`/start updates` • `/stop updates`\n`/start reduceri` • `/stop reduceri`" },
      { name: "\u2699 Preferințe Server (admin)",
        value: "`/set mode <compact|detailed>`\n`/set mindiscount <0-100>`\n`/set free <on|off>` • `/set paid <on|off>`\n`/set currency <USD|EUR|GBP|RON>`" },
      { name: "\u{1F50D} Manuale",
        value: "`/latest updates` • `/latest reduceri`\n`/latest update <joc>` • `/latest pret <joc>`\n`/dlc <joc>` • `/status <joc>`" }
    );
}

// -------------------------------------------------------------
// MASTER INTERACTION DISPATCHER
// -------------------------------------------------------------
async function handleInteraction(interaction, games) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    return interaction.reply({ content: "Comenzile sunt disponibile doar pe servere.", flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const cmd = interaction.commandName;
  try {
    if (cmd === "ping") return handlePingInteraction(interaction);
    if (cmd === "games") return handleGamesInteraction(interaction, games);
    if (cmd === "help") return handleHelpInteraction(interaction);
    if (cmd === "start") return handleStartInteraction(interaction, games);
    if (cmd === "stop") return handleStopInteraction(interaction);
    if (cmd === "set") return handleSetInteraction(interaction);
    if (cmd === "latest") return handleLatestInteraction(interaction, games);
    if (cmd === "dlc") return handleDlcInteraction(interaction);
    if (cmd === "status") return handleStatusInteraction(interaction, games);
  } catch (err) {
    logger("ERROR", "INTERACTION", "Eroare în handler-ul de comenzi", err.stack || err.message);
    const errPayload = { content: "\u274C Eroare neașteptată la procesarea comenzii.", flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(errPayload);
      else await interaction.reply(errPayload);
    } catch { /* ignore */ }
  }
}

module.exports = {
  startCacheCleaner, cleanCache, getCacheSizes,
  setGlobalCacheTtl,
  checkForUpdates, checkForDiscounts,
  registerSlashCommands, buildSlashCommandDefinitions,
  handleInteraction,
  buildHelpEmbed,
  formatUserError
};
