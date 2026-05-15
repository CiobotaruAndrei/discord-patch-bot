"use strict";

const crypto = require("crypto");
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
  truncate, levenshtein,
  executeFetchWithCircuitBreaker, getLatestForAllGames,
  fetchDeals, enrichDealData, dealHash,
  searchSteamGameByName, chooseBestSteamMatch,
  fetchSteamPriceDetails, extractSteamOfferEndDate,
  httpReq, safeCheerioLoad,
  MAX_DEALS
} = require("./scrapers");

const CACHE_TTL_MS = 180000;
const CACHE_CLEAN_INTERVAL_MS = 300000;
const ITEMS_PER_PAGE = 5;
const DLC_ITEMS_PER_PAGE = 10;
const COMMAND_OUTPUT_MAX_CHARS = 1900;
const DLC_CACHE_MAX_SIZE = 100;
const SINGLE_CACHE_MAX_SIZE = 100;

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

let GLOBAL_CACHE_TTL_MS = 1800000;
function setGlobalCacheTtl(ms) {
  if (Number.isFinite(ms) && ms > 0) {
    GLOBAL_CACHE_TTL_MS = Math.min(ms, 30 * 60 * 1000);
    logger("INFO", "CACHE", `GLOBAL_CACHE_TTL_MS setat la ${GLOBAL_CACHE_TTL_MS}ms`);
  }
}

const cache = {
  updates: { data: null, expiresAt: 0 },
  dealsByCurrency: new Map(),
  single: new Map(),
  dlc: new Map()
};

function getUpdatesCacheData() {
  if (!cache.updates.data) return null;
  if (cache.updates.expiresAt <= Date.now()) {
    cache.updates = { data: null, expiresAt: 0 };
    return null;
  }
  return cache.updates.data;
}

function setUpdatesCache(data) {
  cache.updates = { data, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
}

function getDealsCacheData(currency) {
  const entry = cache.dealsByCurrency.get(currency);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.dealsByCurrency.delete(currency);
    return null;
  }
  return entry.data;
}

function setDealsCache(currency, data) {
  cache.dealsByCurrency.set(currency, { data, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS });
}

function cacheGetLRU(map, key) {
  const value = map.get(key);
  if (!value) return null;
  if (value.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  map.delete(key);
  map.set(key, value);
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

const USER_COOLDOWNS_THRESHOLD = 500;
const userCommandCooldowns = new Map();

function checkUserCooldown(userId, command) {
  if (USER_COMMAND_COOLDOWN_MS === 0) return { allowed: true };
  const key = `${userId}:${command}`;
  const last = userCommandCooldowns.get(key) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < USER_COMMAND_COOLDOWN_MS) {
    return { allowed: false, remainingMs: USER_COMMAND_COOLDOWN_MS - elapsed };
  }
  userCommandCooldowns.set(key, now);
  if (userCommandCooldowns.size > USER_COOLDOWNS_THRESHOLD) cleanUserCooldowns();
  return { allowed: true };
}

function cleanUserCooldowns() {
  if (USER_COMMAND_COOLDOWN_MS === 0) {
    userCommandCooldowns.clear();
    return;
  }
  const now = Date.now();
  for (const [key, ts] of userCommandCooldowns.entries()) {
    if (now - ts > USER_COMMAND_COOLDOWN_MS * 2) userCommandCooldowns.delete(key);
  }
}

function cleanCache() {
  const now = Date.now();
  if (cache.updates.expiresAt <= now) cache.updates = { data: null, expiresAt: 0 };
  for (const [currency, entry] of cache.dealsByCurrency.entries()) {
    if (entry.expiresAt <= now) cache.dealsByCurrency.delete(currency);
  }
  for (const [key, value] of cache.single.entries()) {
    if (value.expiresAt <= now) cache.single.delete(key);
  }
  for (const [key, value] of cache.dlc.entries()) {
    if (value.expiresAt <= now) cache.dlc.delete(key);
  }
  while (cache.single.size > SINGLE_CACHE_MAX_SIZE) cache.single.delete(cache.single.keys().next().value);
  while (cache.dlc.size > DLC_CACHE_MAX_SIZE) cache.dlc.delete(cache.dlc.keys().next().value);
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

function smoothTime(oldMs, newMs, alpha = 0.3) {
  return Math.round(oldMs * (1 - alpha) + newMs * alpha);
}

function formatUserError(err, defaultMsg = "A aparut o eroare interna.", errorCode = null) {
  if (err) logger("WARN", "USER_COMMAND", `${defaultMsg}${errorCode ? ` [${errorCode}]` : ""}`, err.stack || err.message || err);
  const suffix = errorCode ? ` \`[${errorCode}]\`` : "";
  return `Eroare: ${defaultMsg}${suffix}`;
}

function canSendEmbeds(channel, botId) {
  if (!channel || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(botId);
  return !!perms && perms.has([
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks
  ]);
}

function missingChannelPermsMessage() {
  return "Eroare: Nu pot activa notificarile pe acest canal. Am nevoie de permisiunile **Send Messages** si **Embed Links**.";
}

function operationalUpdateOptions() {
  return { strict: false };
}

function makeActivationId() {
  return crypto.randomBytes(8).toString("hex");
}

async function sleepIfPositive(ms) {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
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

function normalizePendingUpdateArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
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
    if (!item || typeof item !== "object" || !item.hash) return null;
    return {
      hash: String(item.hash),
      snapshot: item.snapshot || null,
      lastSeenAt: item.lastSeenAt || new Date(),
      attempts: typeof item.attempts === "number" ? item.attempts : 0
    };
  }).filter(Boolean);
}

function toEntries(value) {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.entries());
  if (typeof value.toObject === "function") return Object.entries(value.toObject());
  return Object.entries(value);
}

function mapToObject(map) {
  return Object.fromEntries(Array.from(map.entries()));
}

function getSeenSet(guild, gameKey) {
  const seenEntries = toEntries(guild.seen);
  const found = seenEntries.find(([key]) => key === gameKey);
  return new Set(Array.isArray(found?.[1]) ? found[1].map(String) : []);
}

function rotateAfter(keys, lastKey) {
  if (!lastKey || !keys.includes(lastKey)) return keys;
  const index = keys.indexOf(lastKey);
  return keys.slice(index + 1).concat(keys.slice(0, index + 1));
}

async function enforceCooldown(interaction, command) {
  const { allowed, remainingMs } = checkUserCooldown(interaction.user?.id, command);
  if (allowed) return true;
  const msg = `Cooldown: Comanda \`${command}\` are cooldown. Reincearca in **${Math.ceil(remainingMs / 1000)}s**.`;
  if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => null);
  else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
  return false;
}

function startCommandLog(interaction, command, extra = {}) {
  const startedAt = Date.now();
  logger("INFO", "USER_CMD", `Comanda pornita: ${command}`, {
    userId: interaction.user?.id,
    guildId: interaction.guild?.id,
    channelId: interaction.channel?.id,
    command,
    ...extra
  });
  return (status = "ok", endExtra = {}) => {
    logger("INFO", "USER_CMD", `Comanda finalizata: ${command} [${status}]`, {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      command,
      status,
      durationMs: Date.now() - startedAt,
      ...endExtra
    });
  };
}

async function safeDefer(interaction, ephemeral = false) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }
  } catch (err) {
    logger("WARN", "INTERACTION", "Eroare la deferReply", err.message);
  }
}

async function safeEdit(interaction, payload) {
  try { return await interaction.editReply(payload); }
  catch (err) {
    logger("WARN", "INTERACTION", "Eroare la editReply", err.message);
    return null;
  }
}

function buildUpdateEmbed(gameName, latest, mode = "detailed") {
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(truncate(latest.title, 256))
    .setFooter({ text: truncate(gameName, 2048) });
  if (latest.link) embed.setURL(latest.link);
  if (isCompact) {
    embed.setDescription(latest.link ? "Apasa pe titlu pentru a citi patch-ul." : `A aparut un nou update pentru ${gameName}.`);
  } else {
    embed.setDescription(truncate(latest.excerpt || `A aparut un nou update pentru ${gameName}.`, 4096));
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
  if (deal.link) embed.setURL(deal.link);
  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~${formatPrice(deal.normalPrice, cur)}~~ -> **${isFree ? "GRATUIT" : formatPrice(deal.salePrice, cur)}**\n[Apasa aici pentru link](${deal.link})`);
    return embed;
  }
  let statsStr = "";
  if (deal.qualityScore > 0) {
    statsStr = `* **Calitate:** ${deal.qualityScore}% aprecieri | Users **Popularitate:** ${deal.totalReviews > 0 ? `${deal.totalReviews} recenzii` : "Top Seller"}\n\n`;
  }
  embed.setAuthor({ name: truncate(deal.store, 256) })
    .setDescription(truncate(`**${deal.store}** ofera o reducere de **${deal.savings}%**!\n\n`
      + statsStr + (deal.endDateStr && deal.endDateStr !== "Nespecificat"
        ? `Se incarca: **${isFree ? "Gratis pana la" : "Expira la"}:** ${deal.endDateStr}\n\n`
        : ""), 4096))
    .addFields(
      { name: "Pret Vechi", value: `~~${formatPrice(deal.normalPrice, cur)}~~`, inline: true },
      { name: "Pret Nou", value: isFree ? "GRATUIT" : formatPrice(deal.salePrice, cur), inline: true },
      { name: "Link", value: `[Apasa aici](${deal.link})`, inline: false }
    );
  if (deal.thumbnail && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
  if (deal.extraDetails) embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails.trim(), 1024), inline: false });
  return embed;
}

function generateSessionId() {
  return crypto.randomBytes(8).toString("hex");
}

function buildPaginationButtons(prefix, sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("<- Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm ->").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
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
      await interactionMessage.edit({
        embeds,
        components: [buildPaginationButtons(prefix, sessionId, currentPage, totalPages)]
      }).catch(() => null);
    } catch {
      if (collector) collector.stop("error");
    }
  };

  await updateMessage();
  collector = interactionMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS
  });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== authorId) {
      return btn.reply({ content: "Doar autorul comenzii poate naviga!", flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !== `${prefix}_next_${sessionId}`) return;
    currentPage += btn.customId === `${prefix}_next_${sessionId}` ? 1 : -1;
    currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));
    await btn.deferUpdate().catch(() => null);
    await updateMessage();
  });
  collector.on("end", () => {
    if (interactionMessage.editable) interactionMessage.edit({ components: [] }).catch(() => null);
  });
}

function findGameAndSuggestion(text, games) {
  let search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (search.length > MAX_FUZZY_SEARCH_INPUT) search = search.substring(0, MAX_FUZZY_SEARCH_INPUT);
  if (search.length < 2) {
    const exact = games.find(g => String(g.key).toLowerCase() === search);
    return { game: exact || null, suggestion: null };
  }
  const candidates = [];
  for (const game of games) {
    const identifiers = [
      String(game.key).toLowerCase().replace(/[-_]/g, " "),
      String(game.name).toLowerCase().replace(/[-_]/g, " "),
      ...(Array.isArray(game.aliases) ? game.aliases.map(a => String(a).toLowerCase().replace(/[-_]/g, " ")) : [])
    ];
    if (identifiers.includes(search)) return { game, suggestion: null };
    let bestDistForGame = Infinity;
    let isStartsWith = false;
    let isIncludes = false;
    for (const val of identifiers) {
      if (val.startsWith(search)) isStartsWith = true;
      if (val.includes(search)) isIncludes = true;
      bestDistForGame = Math.min(bestDistForGame, levenshtein(search, val));
    }
    candidates.push({ game, dist: bestDistForGame, isStartsWith, isIncludes });
  }
  candidates.sort((a, b) => {
    if (a.isStartsWith !== b.isStartsWith) return a.isStartsWith ? -1 : 1;
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.isIncludes !== b.isIncludes) return a.isIncludes ? -1 : 1;
    return 0;
  });
  const best = candidates[0];
  if (!best) return { game: null, suggestion: null };
  const dynamicThreshold = Math.max(1, Math.floor(search.length * 0.3));
  if (best.dist <= 1) return { game: best.game, suggestion: null };
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) return { game: null, suggestion: best.game };
  return { game: null, suggestion: null };
}

async function fetchGameStatus(game) {
  let statusText = "Nu am un API oficial live integrat pentru acest joc. Iti dau pagina oficiala/fallback ca sa verifici manual.";
  let statusLink = "";
  let homepageLink = "";
  let color = 0x3498db;

  if (game.type === "epic_games") {
    try {
      const res = await httpReq("GET", "https://status.epicgames.com/api/v2/status.json");
      statusText = `**Status Server:** ${res.data.status.description}`;
      statusLink = "https://status.epicgames.com/";
      color = res.data.status.indicator === "none" ? 0x2ecc71 : 0xe74c3c;
    } catch (err) {
      statusText = "Nu am putut prelua statusul automat. Verifica pagina oficiala.";
      statusLink = "https://status.epicgames.com/";
    }
  } else if (game.key === "roblox") {
    statusLink = "https://status.roblox.com/";
    statusText = "Pentru Roblox folosesc pagina oficiala de status.";
  } else if (game.key === "valorant" || game.key === "lol") {
    statusLink = "https://status.riotgames.com/";
    statusText = "Pentru Riot Games folosesc pagina oficiala de status.";
  } else if (game.key === "minecraft") {
    statusLink = "https://help.minecraft.net/hc/en-us/articles/360052646271-Minecraft-Server-Status";
  } else {
    homepageLink = game.url || game.baseUrl || "";
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Status servere: ${game.name}`)
    .setDescription(statusText);
  if (statusLink) {
    embed.addFields({ name: "Pagina oficiala de status", value: `[Verifica statusul aici](${statusLink})` });
  } else if (homepageLink && homepageLink.startsWith("http")) {
    embed.addFields({
      name: "Pagina principala / fallback",
      value: `[Acceseaza homepage](${homepageLink})\n*(Acesta nu este un API live de status.)`
    });
  }
  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}

function buildSteamPriceEmbed(gameData, appId, offerEndDate, currency) {
  const cur = currency || DEFAULT_CURRENCY;
  const typeStr = gameData.type === "game" ? "Joc"
    : gameData.type === "dlc" ? "DLC / Extensie"
    : gameData.type === "music" ? "Coloana Sonora"
    : gameData.type === "demo" ? "Demo" : "Aplicatie/Bundle";
  const priceOverview = gameData.price_overview;
  let embedDesc = `**Tip produs:** ${typeStr}\n\n`;
  let color = 0x2b2d31;

  if (gameData.is_free) {
    embedDesc += "Acest titlu este in prezent **GRATUIT** (Free to Play).";
    color = 0xffd700;
  } else if (!priceOverview) {
    embedDesc += "Pretul nu este disponibil in acest moment.";
  } else {
    const normalPrice = (priceOverview.initial / 100).toFixed(2);
    const currentPrice = (priceOverview.final / 100).toFixed(2);
    if (priceOverview.discount_percent > 0) {
      embedDesc += `Este o reducere activa de **${priceOverview.discount_percent}%**!\n\n~~${formatPrice(normalPrice, cur)}~~ -> **${formatPrice(currentPrice, cur)}**`;
      embedDesc += `\nSe incarca: **Oferta expira la:** ${offerEndDate || "Nespecificat"}`;
      color = 0xe74c3c;
    } else {
      embedDesc += `Nu este la reducere in acest moment.\n\nPret standard: **${formatPrice(normalPrice, cur)}**`;
      color = 0x57f287;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Pret curent pe Steam: ${gameData.name}`)
    .setURL(`https://store.steampowered.com/app/${appId}`)
    .setDescription(embedDesc);
  if (gameData.header_image) embed.setImage(gameData.header_image);
  return embed;
}

async function claimSeenUpdate(guildId, channelId, gameKey, updateId) {
  return GuildModel.updateOne(
    {
      _id: guildId,
      subscribed: true,
      notificationChannelId: channelId,
      updatesInitializing: { $ne: true },
      [`seen.${gameKey}`]: { $ne: updateId }
    },
    {
      $push: { [`seen.${gameKey}`]: { $each: [updateId], $slice: -SEEN_PER_GAME_LIMIT } },
      $pull: { [`pendingUpdates.${gameKey}`]: { id: updateId } },
      $set: { lastProcessedGameKey: gameKey }
    },
    operationalUpdateOptions()
  );
}

async function rollbackSeenUpdate(guildId, gameKey, updateId) {
  return GuildModel.updateOne(
    { _id: guildId },
    { $pull: { [`seen.${gameKey}`]: updateId } }
  );
}

async function disableUpdatesForChannelError(guildId, channelId, message) {
  return GuildModel.updateOne(
    { _id: guildId },
    {
      $set: {
        subscribed: false,
        notificationChannelId: null,
        updatesInitializing: false,
        updatesLastError: { message, channelId, at: new Date() }
      }
    },
    operationalUpdateOptions()
  );
}

async function processGuildUpdates(client, guild, latestResults) {
  const channel = await client.channels.fetch(guild.notificationChannelId).catch(() => null);
  if (!canSendEmbeds(channel, client.user.id)) {
    const message = "Canal invalid sau fara permisiuni Send Messages/Embed Links.";
    await disableUpdatesForChannelError(String(guild._id), guild.notificationChannelId, message).catch(() => null);
    logger("WARN", "CRON_UPDATES", `${message} Guild ${guild._id}`);
    return;
  }

  const now = Date.now();
  const pendingByGame = new Map();
  const seenByGame = new Map();
  for (const [gameKey, seen] of toEntries(guild.seen)) {
    seenByGame.set(gameKey, new Set(Array.isArray(seen) ? seen.map(String) : []));
  }
  for (const [gameKey, arr] of toEntries(guild.pendingUpdates)) {
    const seenSet = seenByGame.get(gameKey) || new Set();
    const cleaned = normalizePendingUpdateArray(arr).filter(item => {
      const age = now - new Date(item.createdAt).getTime();
      return !seenSet.has(item.id)
        && age <= PENDING_UPDATE_MAX_AGE_MS
        && item.attempts < PENDING_UPDATE_MAX_ATTEMPTS;
    }).slice(-PENDING_UPDATES_PER_GAME_LIMIT);
    if (cleaned.length) pendingByGame.set(gameKey, cleaned);
  }

  for (const result of latestResults) {
    if (!result?.game?.key || !result.latest) continue;
    const gameKey = result.game.key;
    const seenSet = seenByGame.get(gameKey) || new Set();
    const queue = pendingByGame.get(gameKey) || [];
    if (!seenSet.has(result.latest.id) && !queue.some(item => item.id === result.latest.id)) {
      queue.push({ ...result.latest, createdAt: new Date(), attempts: 0 });
      pendingByGame.set(gameKey, queue.slice(-PENDING_UPDATES_PER_GAME_LIMIT));
    }
  }

  let sentCount = 0;
  let lastProcessedGameKey = guild.lastProcessedGameKey || null;
  while (sentCount < MAX_UPDATES_PER_CYCLE) {
    const keys = Array.from(pendingByGame.keys()).filter(key => pendingByGame.get(key)?.length);
    if (!keys.length) break;
    const gameKey = rotateAfter(keys, lastProcessedGameKey)[0];
    const queue = pendingByGame.get(gameKey);
    const next = queue.shift();
    const game = latestResults.find(r => r.game.key === gameKey)?.game || { name: gameKey };
    const claim = await claimSeenUpdate(String(guild._id), channel.id, gameKey, next.id);
    if (claim.matchedCount === 0) {
      if (queue.length) pendingByGame.set(gameKey, queue);
      else pendingByGame.delete(gameKey);
      continue;
    }
    try {
      await channel.send({ embeds: [buildUpdateEmbed(game.name, next, guild.notificationMode || "detailed")] });
      sentCount++;
      lastProcessedGameKey = gameKey;
      await sleepIfPositive(DISCORD_SEND_DELAY_MS);
    } catch (err) {
      await rollbackSeenUpdate(String(guild._id), gameKey, next.id).catch(() => null);
      next.attempts = (next.attempts || 0) + 1;
      if (next.attempts < PENDING_UPDATE_MAX_ATTEMPTS) queue.unshift(next);
      logger("WARN", "CRON_UPDATES", `Nu am putut trimite update pentru ${gameKey}`, err.message);
      break;
    }
    if (queue.length) pendingByGame.set(gameKey, queue);
    else pendingByGame.delete(gameKey);
  }

  const pendingObject = mapToObject(pendingByGame);
  const setDoc = { pendingUpdates: pendingObject };
  if (lastProcessedGameKey) setDoc.lastProcessedGameKey = lastProcessedGameKey;
  await GuildModel.updateOne(
    { _id: guild._id, subscribed: true, notificationChannelId: channel.id },
    { $set: setDoc }
  );
}

async function checkForUpdates(client, games, shouldAbort = null) {
  if (shouldAbort?.()) return;
  let latestResults;
  try {
    latestResults = await getLatestForAllGames(games, shouldAbort);
    setUpdatesCache(latestResults);
  } catch (err) {
    logger("ERROR", "CRON_UPDATES", "Nu am putut prelua update-urile", err.message);
    return;
  }
  if (shouldAbort?.()) return;
  const guilds = await GuildModel.find({
    subscribed: true,
    notificationChannelId: { $ne: null },
    updatesInitializing: { $ne: true }
  }).lean();
  await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
    if (!shouldAbort?.()) await processGuildUpdates(client, guild, latestResults);
  }, {
    errorLogger: (guild, err) => logger("WARN", "CRON_UPDATES", `Eroare procesare guild ${guild._id}`, err.message)
  });
}

async function claimSeenDiscount(guildId, channelId, hash) {
  return GuildModel.updateOne(
    {
      _id: guildId,
      discountsSubscribed: true,
      discountChannelId: channelId,
      discountsInitializing: { $ne: true },
      seenDiscounts: { $ne: hash }
    },
    {
      $push: { seenDiscounts: { $each: [hash], $slice: -DEALS_HISTORY_LIMIT } },
      $pull: { pendingDiscounts: { hash } }
    },
    operationalUpdateOptions()
  );
}

async function rollbackSeenDiscount(guildId, hash) {
  return GuildModel.updateOne(
    { _id: guildId },
    { $pull: { seenDiscounts: hash } }
  );
}

async function disableDiscountsForChannelError(guildId, channelId, message) {
  return GuildModel.updateOne(
    { _id: guildId },
    {
      $set: {
        discountsSubscribed: false,
        discountChannelId: null,
        discountsInitializing: false,
        discountsLastError: { message, channelId, at: new Date() }
      }
    },
    operationalUpdateOptions()
  );
}

async function processGuildDiscounts(client, guild, deals) {
  const channel = await client.channels.fetch(guild.discountChannelId).catch(() => null);
  if (!canSendEmbeds(channel, client.user.id)) {
    const message = "Canal invalid sau fara permisiuni Send Messages/Embed Links.";
    await disableDiscountsForChannelError(String(guild._id), guild.discountChannelId, message).catch(() => null);
    logger("WARN", "CRON_DISCOUNTS", `${message} Guild ${guild._id}`);
    return;
  }

  const seenSet = new Set(Array.isArray(guild.seenDiscounts) ? guild.seenDiscounts.map(String) : []);
  const dealsByHash = new Map(deals.map(deal => [dealHash(deal), deal]));
  const pending = [];
  for (const old of normalizePendingDiscountArray(guild.pendingDiscounts)) {
    if (seenSet.has(old.hash) || old.attempts >= PENDING_DISCOUNT_MAX_ATTEMPTS) continue;
    const fresh = dealsByHash.get(old.hash);
    if (fresh) {
      if (dealPassesFilters(fresh, guild)) pending.push({ hash: old.hash, snapshot: fresh, lastSeenAt: new Date(), attempts: old.attempts || 0 });
    } else if (old.attempts < PENDING_DISCOUNT_GRACE_CYCLES
        && validatePendingDiscountSnapshot(old.snapshot)
        && dealPassesFilters(old.snapshot, guild)) {
      pending.push({ ...old, attempts: (old.attempts || 0) + 1 });
    }
  }

  const pendingHashes = new Set(pending.map(item => item.hash));
  for (const deal of deals) {
    const hash = dealHash(deal);
    if (seenSet.has(hash) || pendingHashes.has(hash) || !dealPassesFilters(deal, guild)) continue;
    pending.push({ hash, snapshot: deal, lastSeenAt: new Date(), attempts: 0 });
    pendingHashes.add(hash);
    if (pending.length >= PENDING_DISCOUNTS_LIMIT) break;
  }

  const remaining = [];
  let sentCount = 0;
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    if (sentCount >= MAX_DEALS_PER_CYCLE) {
      remaining.push(...pending.slice(i));
      break;
    }
    let claimed = false;
    try {
      const dealToSend = await enrichDealData(item.snapshot, guild.currency || DEFAULT_CURRENCY);
      const claim = await claimSeenDiscount(String(guild._id), channel.id, item.hash);
      if (claim.matchedCount === 0) continue;
      claimed = true;
      await channel.send({ embeds: [buildDealEmbed(dealToSend, guild.notificationMode || "detailed", guild.currency || DEFAULT_CURRENCY)] });
      sentCount++;
      await sleepIfPositive(DISCORD_SEND_DELAY_MS);
    } catch (err) {
      if (claimed) await rollbackSeenDiscount(String(guild._id), item.hash).catch(() => null);
      const retry = { ...item, attempts: (item.attempts || 0) + 1 };
      if (retry.attempts < PENDING_DISCOUNT_MAX_ATTEMPTS) remaining.push(retry);
      remaining.push(...pending.slice(i + 1));
      logger("WARN", "CRON_DISCOUNTS", "Nu am putut trimite reducere", err.message);
      break;
    }
  }

  await GuildModel.updateOne(
    { _id: guild._id, discountsSubscribed: true, discountChannelId: channel.id },
    { $set: { pendingDiscounts: remaining.slice(-PENDING_DISCOUNTS_LIMIT) } }
  );
}

async function checkForDiscounts(client, shouldAbort = null) {
  if (shouldAbort?.()) return;
  const guilds = await GuildModel.find({
    discountsSubscribed: true,
    discountChannelId: { $ne: null },
    discountsInitializing: { $ne: true }
  }).lean();
  if (!guilds.length) return;

  const dealsPromises = new Map();
  async function dealsForCurrency(currency) {
    const cur = currency || DEFAULT_CURRENCY;
    const cached = getDealsCacheData(cur);
    if (cached) return cached;
    if (!dealsPromises.has(cur)) {
      dealsPromises.set(cur, fetchDeals({ currency: cur, fromCron: true }).then(deals => {
        setDealsCache(cur, deals);
        return deals;
      }));
    }
    return dealsPromises.get(cur);
  }

  await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild) => {
    if (shouldAbort?.()) return;
    const currency = guild.currency || DEFAULT_CURRENCY;
    const deals = await dealsForCurrency(currency);
    await processGuildDiscounts(client, guild, deals);
  }, {
    errorLogger: (guild, err) => logger("WARN", "CRON_DISCOUNTS", `Eroare procesare guild ${guild._id}`, err.message)
  });
}

const CURRENCY_CHOICES = Object.keys(SUPPORTED_CURRENCIES).map(c => ({ name: c, value: c }));

function buildSlashCommandDefinitions() {
  return [
    new SlashCommandBuilder().setName("ping").setDescription("Verifica daca botul raspunde"),
    new SlashCommandBuilder().setName("games").setDescription("Listeaza jocurile urmarite (poreclele acceptate)"),
    new SlashCommandBuilder().setName("help").setDescription("Afiseaza meniul de ajutor"),
    new SlashCommandBuilder()
      .setName("start")
      .setDescription("Porneste notificarile automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(s => s.setName("updates").setDescription("Porneste update-urile pe acest canal"))
      .addSubcommand(s => s.setName("reduceri").setDescription("Porneste alertele de reduceri pe acest canal")),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Opreste notificarile automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(s => s.setName("updates").setDescription("Opreste update-urile"))
      .addSubcommand(s => s.setName("reduceri").setDescription("Opreste alertele de reduceri")),
    new SlashCommandBuilder()
      .setName("set")
      .setDescription("Configureaza preferintele serverului (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(s => s.setName("mode").setDescription("Mod afisare embed")
        .addStringOption(o => o.setName("value").setDescription("compact sau detailed").setRequired(true)
          .addChoices({ name: "compact", value: "compact" }, { name: "detailed", value: "detailed" })))
      .addSubcommand(s => s.setName("mindiscount").setDescription("Procent minim reducere (0-100)")
        .addIntegerOption(o => o.setName("value").setDescription("0-100").setRequired(true).setMinValue(0).setMaxValue(100)))
      .addSubcommand(s => s.setName("free").setDescription("Afiseaza jocurile gratuite?")
        .addStringOption(o => o.setName("value").setDescription("on/off").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand(s => s.setName("paid").setDescription("Afiseaza ofertele platite?")
        .addStringOption(o => o.setName("value").setDescription("on/off").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand(s => s.setName("currency").setDescription("Valuta pentru afisarea preturilor")
        .addStringOption(o => o.setName("value").setDescription("USD/EUR/GBP/RON").setRequired(true)
          .addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("latest")
      .setDescription("Comenzi pentru ultimele update-uri/oferte")
      .addSubcommand(s => s.setName("updates").setDescription("Cele mai recente update-uri pentru toate jocurile"))
      .addSubcommand(s => s.setName("reduceri").setDescription("Cele mai bune reduceri actuale"))
      .addSubcommand(s => s.setName("update").setDescription("Ultimul update pentru un joc specific")
        .addStringOption(o => o.setName("joc").setDescription("Numele/porecla jocului").setRequired(true)))
      .addSubcommand(s => s.setName("pret").setDescription("Cauta pretul curent pe Steam")
        .addStringOption(o => o.setName("joc").setDescription("Numele jocului").setRequired(true))),
    new SlashCommandBuilder()
      .setName("dlc")
      .setDescription("Cauta DLC-urile pentru un joc pe Steam")
      .addStringOption(o => o.setName("joc").setDescription("Numele jocului").setRequired(true)),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Verifica status server pentru un joc")
      .addStringOption(o => o.setName("joc").setDescription("Numele/porecla jocului").setRequired(true))
  ].map(b => b.toJSON());
}

async function registerSlashCommands(token, clientId) {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = buildSlashCommandDefinitions();
  await rest.put(Routes.applicationCommands(clientId), { body });
  logger("INFO", "SLASH", `Inregistrate ${body.length} slash commands global.`);
}

async function handlePingInteraction(interaction) {
  return interaction.reply("Pong! ");
}

async function handleGamesInteraction(interaction, games) {
  const lines = games.map(g => {
    let item = `- **${g.name}** (\`${g.key}\`)`;
    if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
    return item;
  });
  let currentMsg = "**Jocuri urmarite:**\n";
  const messages = [];
  for (const line of lines) {
    if (currentMsg.length + line.length > COMMAND_OUTPUT_MAX_CHARS) {
      messages.push(currentMsg);
      currentMsg = "";
    }
    currentMsg += line + "\n";
  }
  if (currentMsg.trim()) messages.push(currentMsg);
  if (!messages.length) return interaction.reply("Nu sunt jocuri configurate.");
  await interaction.reply(messages[0]);
  for (let i = 1; i < messages.length; i++) await interaction.followUp(messages[i]).catch(() => null);
}

async function handleHelpInteraction(interaction) {
  return interaction.reply({ embeds: [buildHelpEmbed()] });
}

async function handleStartInteraction(interaction, games) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  await safeDefer(interaction);

  if (!canSendEmbeds(interaction.channel, interaction.client.user.id)) {
    return safeEdit(interaction, missingChannelPermsMessage());
  }

  if (sub === "updates") {
    try {
      const activationId = makeActivationId();
      await GuildModel.updateOne(
        { _id: guildId },
        {
          $set: {
            subscribed: true,
            notificationChannelId: interaction.channel.id,
            updatesInitializing: true,
            updatesActivationId: activationId,
            pendingUpdates: {}
          },
          $unset: { updatesLastError: "" }
        },
        { upsert: true, ...operationalUpdateOptions() }
      );
      invalidateGuildCache(guildId);

      try {
        const results = await getLatestForAllGames(games);
        const seenPayload = {
          updatesInitializing: false
        };
        for (const result of results) {
          if (result.latest) seenPayload[`seen.${result.game.key}`] = [result.latest.id];
        }
        const activationResult = await GuildModel.updateOne(
          {
            _id: guildId,
            subscribed: true,
            notificationChannelId: interaction.channel.id,
            updatesActivationId: activationId
          },
          {
            $set: seenPayload,
            $unset: { updatesActivationId: "", updatesLastError: "" }
          },
          operationalUpdateOptions()
        );
        if (activationResult.matchedCount === 0) {
          return safeEdit(interaction, "Activarea update-urilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start updates daca mai vrei activarea.");
        }
        return safeEdit(interaction, "OK: Update-uri automate activate.");
      } catch (err) {
        await GuildModel.updateOne(
          { _id: guildId, updatesActivationId: activationId },
          {
            $set: {
              subscribed: false,
              notificationChannelId: null,
              updatesInitializing: false,
              updatesLastError: { message: err.message, channelId: interaction.channel.id, at: new Date() }
            },
            $unset: { updatesActivationId: "" }
          },
          operationalUpdateOptions()
        ).catch(() => null);
        logger("WARN", "START_UPDATES", "Activat, dar baseline-ul initial a esuat", err.message);
        invalidateGuildCache(guildId);
        return safeEdit(interaction, formatUserError(err, "Nu am activat update-urile fiindca baseline-ul initial nu a putut fi incarcat."));
      }
    } catch (err) {
      return safeEdit(interaction, formatUserError(err, "Eroare la activarea update-urilor."));
    }
  }

  if (sub === "reduceri") {
    try {
      const activationId = makeActivationId();
      const existingGuild = await getGuildSettings(guildId);
      const currency = existingGuild?.currency || DEFAULT_CURRENCY;
      await GuildModel.updateOne(
        { _id: guildId },
        {
          $set: {
            discountsSubscribed: true,
            discountChannelId: interaction.channel.id,
            discountsInitializing: true,
            discountsActivationId: activationId,
            pendingDiscounts: []
          },
          $unset: { discountsLastError: "" }
        },
        { upsert: true, ...operationalUpdateOptions() }
      );
      invalidateGuildCache(guildId);

      try {
        const deals = await fetchDeals({ currency });
        const initHashes = deals.map(deal => dealHash(deal)).slice(0, DEALS_HISTORY_LIMIT);
        const activationResult = await GuildModel.updateOne(
          {
            _id: guildId,
            discountsSubscribed: true,
            discountChannelId: interaction.channel.id,
            discountsActivationId: activationId
          },
          {
            $set: {
              seenDiscounts: initHashes,
              discountsInitializing: false
            },
            $unset: { discountsActivationId: "", discountsLastError: "" }
          },
          operationalUpdateOptions()
        );
        if (activationResult.matchedCount === 0) {
          return safeEdit(interaction, "Activarea reducerilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start reduceri daca mai vrei activarea.");
        }
        setDealsCache(currency, deals);
        return safeEdit(interaction, `OK: Alerte reduceri activate pe acest canal. Valuta: **${currency}**.`);
      } catch (err) {
        await GuildModel.updateOne(
          { _id: guildId, discountsActivationId: activationId },
          {
            $set: {
              discountsSubscribed: false,
              discountChannelId: null,
              discountsInitializing: false,
              discountsLastError: { message: err.message, channelId: interaction.channel.id, at: new Date() }
            },
            $unset: { discountsActivationId: "" }
          },
          operationalUpdateOptions()
        ).catch(() => null);
        logger("WARN", "START_DISCOUNTS", "Activat, dar baseline-ul de reduceri a esuat", err.message);
        invalidateGuildCache(guildId);
        return safeEdit(interaction, formatUserError(err, "Nu am activat reducerile fiindca baseline-ul initial nu a putut fi incarcat."));
      }
    } catch (err) {
      return safeEdit(interaction, formatUserError(err, "Eroare la activarea reducerilor."));
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
        $set: { subscribed: false, notificationChannelId: null, updatesInitializing: false, pendingUpdates: {} },
        $unset: { updatesActivationId: "" }
      }, operationalUpdateOptions());
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: Update-uri oprite.");
    }
    if (sub === "reduceri") {
      await GuildModel.updateOne({ _id: guildId }, {
        $set: { discountsSubscribed: false, discountChannelId: null, discountsInitializing: false, pendingDiscounts: [] },
        $unset: { discountsActivationId: "" }
      }, operationalUpdateOptions());
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: Reduceri oprite.");
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
    confirmMsg = `OK: Mod setat: **${value}**`;
  } else if (sub === "mindiscount") {
    const min = interaction.options.getInteger("value");
    updateDoc.minDiscountPercent = min;
    confirmMsg = `OK: Reducere minima: **${min}%**`;
    isFilterChange = true;
  } else if (sub === "free") {
    const value = interaction.options.getString("value");
    updateDoc.includeFreeGames = value === "on";
    confirmMsg = `OK: Jocuri free: **${value.toUpperCase()}**`;
    isFilterChange = true;
  } else if (sub === "paid") {
    const value = interaction.options.getString("value");
    updateDoc.includePaidDiscounts = value === "on";
    confirmMsg = `OK: Oferte platite: **${value.toUpperCase()}**`;
    isFilterChange = true;
  } else if (sub === "currency") {
    const value = interaction.options.getString("value");
    updateDoc.currency = value;
    confirmMsg = `OK: Valuta setata: **${value}**`;
    isFilterChange = true;
  }
  if (isFilterChange) updateDoc.pendingDiscounts = [];
  try {
    await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, confirmMsg + (isFilterChange ? " *(coada de pending a fost resetata)*" : ""));
  } catch (err) {
    return safeEdit(interaction, formatUserError(err, "Eroare la salvarea preferintelor."));
  }
}

async function handleLatestInteraction(interaction, games) {
  const sub = interaction.options.getSubcommand();
  if (sub === "updates") return handleLatestUpdatesInteraction(interaction, games);
  if (sub === "reduceri") return handleLatestDealsInteraction(interaction);
  if (sub === "update") return handleLatestSingleInteraction(interaction, interaction.options.getString("joc"), games);
  if (sub === "pret") return handlePriceSearchInteraction(interaction, interaction.options.getString("joc"));
}

async function handleLatestUpdatesInteraction(interaction, games) {
  if (!(await enforceCooldown(interaction, "latest updates"))) return;
  const endLog = startCommandLog(interaction, "latest updates");
  await safeDefer(interaction);

  let data = getUpdatesCacheData();
  if (!data) {
    const estMs = (await getSystemTimes()).all || 35000;
    await safeEdit(interaction, `Se incarca: *Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
      data = await getLatestForAllGames(games);
      setUpdatesCache(data);
      const sys = await getSystemTimes();
      sys.all = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    } catch (err) {
      endLog("error", { errorMsg: err.message });
      return safeEdit(interaction, formatUserError(err, "Nu am reusit sa obtin update-urile.", "ERR_LATEST_UPDATES"));
    }
  }
  const valid = data.filter(r => r.latest !== null);
  if (!valid.length) {
    endLog("no_data");
    return safeEdit(interaction, "Eroare: Nu am date disponibile.");
  }
  const guild = await getGuildSettings(interaction.guild.id);
  const mode = guild?.notificationMode || "detailed";
  const msg = await safeEdit(interaction, "OK: Date incarcate!");
  const generateEmbeds = async (page, totalP, currentMode) =>
    valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map(r =>
      buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} - Pagina ${page + 1}/${totalP}` })
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

  let deals = getDealsCacheData(currency);
  if (!deals) {
    const estMs = (await getSystemTimes()).reduceri || 10000;
    await safeEdit(interaction, `Se incarca: *Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
    const startTime = Date.now();
    try {
      deals = await fetchDeals({ currency });
      setDealsCache(currency, deals);
      const sys = await getSystemTimes();
      sys.reduceri = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    } catch (err) {
      endLog("error", { errorMsg: err.message });
      return safeEdit(interaction, formatUserError(err, "Nu am putut interoga magazinele.", "ERR_LATEST_DEALS"));
    }
  }
  const top = deals.filter(d => dealPassesFilters(d, guild)).slice(0, MAX_DEALS);
  if (!top.length) {
    endLog("no_data");
    return safeEdit(interaction, "Eroare: Nu am gasit oferte care sa corespunda setarilor serverului.");
  }
  const msg = await safeEdit(interaction, "OK: Oferte incarcate!");
  const generateEmbeds = async (page, totalP, currentMode) => {
    const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
    const dealsToRender = currentMode === "compact"
      ? chunk
      : await Promise.all(chunk.map(async (deal) => {
          try { return await enrichDealData(deal, currency); }
          catch (err) {
            logger("WARN", "ENRICH", "Eroare enrich command handler", err.message);
            return deal;
          }
        }));
    return dealsToRender.map(d => buildDealEmbed(d, currentMode, currency).setFooter({ text: `Pagina ${page + 1}/${totalP}` }));
  };
  endLog("ok", { resultCount: top.length });
  if (msg) await handlePagination(msg, interaction.user.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode);
}

async function handleLatestSingleInteraction(interaction, gameText, games) {
  if (!gameText) return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
  const endLog = startCommandLog(interaction, "latest update", { query: gameText });
  await safeDefer(interaction);

  const estMs = (await getSystemTimes()).single || 2000;
  await safeEdit(interaction, `Se incarca: *Ma conectez... Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde**.*`);
  const startTime = Date.now();
  const { game, suggestion } = findGameAndSuggestion(gameText, games);
  if (!game) {
    endLog("not_found", { suggestion: suggestion?.key });
    let errText = "Eroare: Nu am gasit jocul.";
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
      const sys = await getSystemTimes();
      sys.single = smoothTime(estMs, Date.now() - startTime);
      await saveSystemTimes(sys);
    }
    const guild = await getGuildSettings(interaction.guild.id);
    endLog("ok", { gameKey: game.key });
    return safeEdit(interaction, {
      content: `OK: Update **${game.name}**:`,
      embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")]
    });
  } catch (err) {
    endLog("error", { gameKey: game.key, errorMsg: err.message });
    return safeEdit(interaction, formatUserError(err, "Nu am putut prelua acest update.", "ERR_LATEST_SINGLE"));
  }
}

async function handlePriceSearchInteraction(interaction, gameName) {
  if (!gameName) return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
  if (!(await enforceCooldown(interaction, "latest pret"))) return;
  const endLog = startCommandLog(interaction, "latest pret", { query: gameName });
  await safeDefer(interaction);

  const guild = await getGuildSettings(interaction.guild.id);
  const currency = guild?.currency || DEFAULT_CURRENCY;
  await safeEdit(interaction, `Se incarca: *Caut pretul pe Steam pentru **${gameName}**...*`);
  try {
    const items = await searchSteamGameByName(gameName, currency);
    if (!items || !items.length) {
      endLog("not_found");
      return safeEdit(interaction, `Eroare: Nu am gasit niciun rezultat pe Steam pentru "**${gameName}**".`);
    }
    const bestMatch = chooseBestSteamMatch(items, gameName, { forceGameOnly: true });
    if (!bestMatch?.id) {
      endLog("no_match");
      return safeEdit(interaction, "Eroare: Nu am putut selecta un rezultat valid de pe Steam.");
    }
    const gameData = await fetchSteamPriceDetails(bestMatch.id, currency);
    if (!gameData) {
      endLog("no_details", { appId: bestMatch.id });
      return safeEdit(interaction, "Eroare: Am gasit un rezultat, dar detaliile de pret nu sunt disponibile.");
    }
    const offerEndDate = gameData.price_overview?.discount_percent > 0
      ? await extractSteamOfferEndDate(bestMatch.id)
      : null;
    endLog("ok", { appId: bestMatch.id });
    return safeEdit(interaction, {
      content: "OK: Am obtinut datele de pe Steam!",
      embeds: [buildSteamPriceEmbed(gameData, bestMatch.id, offerEndDate, currency)]
    });
  } catch (err) {
    endLog("error", { errorMsg: err.message });
    logger("ERROR", "PRICE_SEARCH", "Eroare la cautare pret", err.message);
    return safeEdit(interaction, "Eroare: A aparut o eroare la cautarea pretului. `[ERR_PRICE_GENERAL]`");
  }
}

async function handleDlcInteraction(interaction) {
  const gameName = interaction.options.getString("joc");
  if (!(await enforceCooldown(interaction, "dlc"))) return;
  const endLog = startCommandLog(interaction, "dlc", { query: gameName });
  await safeDefer(interaction);

  const guild = await getGuildSettings(interaction.guild.id);
  const currency = guild?.currency || DEFAULT_CURRENCY;
  await safeEdit(interaction, `Se incarca: *Caut DLC-urile pentru **${gameName}**...*`);

  try {
    const items = await searchSteamGameByName(gameName, currency);
    if (!items || !items.length) {
      endLog("not_found");
      return safeEdit(interaction, `Eroare: Nu am gasit niciun rezultat pe Steam pentru "**${gameName}**".`);
    }
    const bestMatch = chooseBestSteamMatch(items, gameName, { forceGameOnly: true });
    if (!bestMatch?.id) {
      endLog("no_match");
      return safeEdit(interaction, "Eroare: Nu am putut selecta un joc valid de pe Steam.");
    }

    const cacheKey = `${bestMatch.id}:${currency}`;
    let dlcData = cacheGetLRU(cache.dlc, cacheKey);
    if (dlcData === null) {
      const title = bestMatch.name;
      let gameDetails = null;
      try { gameDetails = await fetchSteamPriceDetails(bestMatch.id, currency); }
      catch (err) { logger("WARN", "DLC_SEARCH", `Nu am putut prelua header_image pentru ${bestMatch.id}`, err.message); }
      const thumbUrl = gameDetails?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${bestMatch.id}/header.jpg`;
      const { getCurrencyConfig } = require("./db");
      const cc = getCurrencyConfig(currency).cc;
      const htmlRes = await httpReq("GET", `https://store.steampowered.com/app/${bestMatch.id}?cc=${cc}`, {
        headers: { Cookie: "birthtime=283993201; mature_content=1;" },
        timeout: 15000
      });
      const $ = safeCheerioLoad(htmlRes.data);
      if ($("#agegate_box").length > 0 || $(".agegate_text_container").length > 0 || htmlRes.request?.path?.includes("agecheck")) {
        endLog("age_gate", { appId: bestMatch.id });
        return safeEdit(interaction, `Eroare: Pagina de Steam pentru **${title}** necesita verificare de varsta, iar botul nu o poate accesa direct.`);
      }

      const dlcList = [];
      const seenDlcIds = new Set();
      $(".game_area_dlc_row").each((i, el) => {
        const dlcName = $(el).find(".game_area_dlc_name").text().trim();
        let dlcPrice = $(el).find(".game_area_dlc_price").text().trim().replace(/\s+/g, " ");
        const dlcAppId = $(el).attr("data-ds-appid") || dlcName;
        if (!dlcPrice) dlcPrice = "Pret indisponibil";
        if (dlcName && !seenDlcIds.has(dlcAppId)) {
          seenDlcIds.add(dlcAppId);
          dlcList.push({ name: dlcName, price: dlcPrice });
        }
      });
      if (!dlcList.length) {
        if ($(".game_area_purchase_game").length === 0) {
          logger("WARN", "DLC_SEARCH", "Schema drift suspectat la pagina DLC", { appId: bestMatch.id, query: gameName });
          endLog("parse_error", { appId: bestMatch.id });
          return safeEdit(interaction, `Eroare: Structura paginii pentru **${title}** nu a putut fi interpretata.`);
        }
        endLog("no_dlc", { appId: bestMatch.id });
        return safeEdit(interaction, `Eroare: Jocul **${title}** nu are niciun DLC listat separat pe magazinul Steam.`);
      }
      dlcData = { dlcList: dlcList.slice(0, 100), title, appId: bestMatch.id, thumbUrl, totalExtracted: dlcList.length };
      cacheSetLRU(cache.dlc, cacheKey, dlcData, CACHE_TTL_MS, DLC_CACHE_MAX_SIZE);
    }

    const { dlcList, title, appId, thumbUrl, totalExtracted } = dlcData;
    const msg = await safeEdit(interaction, `OK: Am gasit **${totalExtracted}** DLC-uri pentru **${title}**!`);
    const generateEmbeds = async (page, totalP) => {
      const chunk = dlcList.slice(page * DLC_ITEMS_PER_PAGE, (page + 1) * DLC_ITEMS_PER_PAGE);
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`DLC-uri: ${title}`)
        .setURL(`https://store.steampowered.com/app/${appId}`)
        .setThumbnail(thumbUrl);
      let desc = "";
      chunk.forEach((dlc, index) => {
        desc += `**${page * DLC_ITEMS_PER_PAGE + index + 1}. ${truncate(dlc.name, 100)}**\nPret: ${dlc.price}\n\n`;
      });
      embed.setDescription(desc);
      embed.setFooter({ text: `Pagina ${page + 1}/${totalP} - Afisate: ${dlcList.length} / Extrase: ${totalExtracted}` });
      return [embed];
    };
    endLog("ok", { appId, dlcCount: totalExtracted });
    if (msg) await handlePagination(msg, interaction.user.id, "dlc_cmd", dlcList, DLC_ITEMS_PER_PAGE, generateEmbeds, "detailed");
  } catch (err) {
    endLog("error", { errorMsg: err.message });
    logger("ERROR", "DLC_SEARCH", "Eroare la extragere DLC-uri", err.message);
    return safeEdit(interaction, "Eroare: A aparut o eroare la cautarea DLC-urilor. `[ERR_DLC_GENERAL]`");
  }
}

async function handleStatusInteraction(interaction, games) {
  const gameText = interaction.options.getString("joc");
  await safeDefer(interaction);
  await safeEdit(interaction, `Se incarca: *Verific statusul serverelor pentru **${gameText}**...*`);
  const { game, suggestion } = findGameAndSuggestion(gameText, games);
  if (!game) {
    let errText = "Eroare: Nu am gasit jocul in baza mea de date.";
    if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
    return safeEdit(interaction, errText);
  }
  try {
    const embed = await fetchGameStatus(game);
    return safeEdit(interaction, { content: `OK: Informatii preluate pentru **${game.name}**:`, embeds: [embed] });
  } catch (err) {
    logger("ERROR", "STATUS", "Eroare la comanda status", err.message);
    return safeEdit(interaction, "Eroare: A aparut o eroare la preluarea statusului. `[ERR_STATUS_GENERAL]`");
  }
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("Meniul de Ajutor - Big Master")
    .setDescription("Toate comenzile sunt slash commands. Incepe cu `/` pentru autocomplete.")
    .addFields(
      { name: "Utilitare", value: "`/ping` - `/games` - `/help`" },
      { name: "Notificari Automate (admin)", value: "`/start updates` - `/stop updates`\n`/start reduceri` - `/stop reduceri`" },
      { name: "Preferinte Server (admin)", value: "`/set mode <compact|detailed>`\n`/set mindiscount <0-100>`\n`/set free <on|off>` - `/set paid <on|off>`\n`/set currency <USD|EUR|GBP|RON>`" },
      { name: "Comenzi Manuale", value: "`/latest updates` - `/latest reduceri`\n`/latest update <joc>` - `/latest pret <joc>`\n`/dlc <joc>` - `/status <joc>`" }
    );
}

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
    logger("ERROR", "INTERACTION", "Eroare in handler-ul de comenzi", err.stack || err.message);
    const payload = { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
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
