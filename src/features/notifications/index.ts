"use strict";

const { errorMessage } = require("../../shared/errors");
const {
  DISCORD_PERMANENT_ERROR_CODES,
  createOutboundChannelResolver,
  isPermanentDiscordError,
  transientErrorMessage
} = require("./outboundChannel");

module.exports = (ctx: any) => {
  const {
    GuildModel, logger, DEFAULT_CURRENCY, runConcurrent,
    validatePendingDiscountSnapshot, getLatestForAllGames, fetchDeals,
    enrichDealData, dealHash, canSendEmbeds, buildUpdateEmbed,
    buildDealEmbed, setUpdatesCache, getDealsCacheData, setDealsCache,
    normalizeCurrencyKey, normalizePendingUpdateArray,
    normalizePendingDiscountArray, toEntries, rotateAfter, mapToObject,
    dealPassesFilters, sleepIfPositive, withMongoRetry, OP_UPDATE_OPTS,
    SEEN_PER_GAME_LIMIT, PENDING_UPDATE_MAX_AGE_MS,
    PENDING_UPDATE_MAX_ATTEMPTS, PENDING_UPDATES_PER_GAME_LIMIT,
    MAX_UPDATES_PER_CYCLE, DISCORD_SEND_DELAY_MS,
    GUILD_PROCESS_CONCURRENCY, DEALS_HISTORY_LIMIT,
    PENDING_DISCOUNT_MAX_ATTEMPTS, PENDING_DISCOUNT_GRACE_CYCLES,
    PENDING_DISCOUNTS_LIMIT, MAX_DEALS_PER_CYCLE
  } = ctx;

const resolveOutboundChannel = createOutboundChannelResolver({ logger, canSendEmbeds });

async function claimSeenUpdate(guildId: string, channelId: string, gameKey: string, updateId: string) {
  return withMongoRetry(() => GuildModel.updateOne(
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
    OP_UPDATE_OPTS
  ), { label: "claimSeenUpdate" });
}

async function rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string) {
  return GuildModel.updateOne(
    { _id: guildId },
    { $pull: { [`seen.${gameKey}`]: updateId } }
  );
}

async function disableUpdatesForChannelError(guildId: string, channelId: string, message: string) {
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
    OP_UPDATE_OPTS
  );
}

// V9: filtram per joc + mentiune rol pe prima trimitere doar.
async function processGuildUpdates(client: any, guild: any, latestResults: any[]) {
  const { channel, abort } = await resolveOutboundChannel({
    client,
    guild,
    channelId: guild.notificationChannelId,
    context: "CRON_UPDATES",
    disableFn: disableUpdatesForChannelError
  });
  if (abort) return;

  // V11: indexam latestResults dupa cheia jocului ca lookup-ul ulterior din
  // bucla de trimitere sa fie O(1) in loc sa parcurga linear toata lista la
  // fiecare iteratie.
  const resultByGameKey = new Map<string, any>();
  for (const result of latestResults) {
    if (result?.game?.key) resultByGameKey.set(result.game.key, result);
  }

  // V9: daca guild-ul are lista explicita de jocuri active, filtram.
  const enabledGames = Array.isArray(guild.enabledGames) ? guild.enabledGames : [];
  const hasGameFilter = enabledGames.length > 0;
  const enabledSet = new Set(enabledGames);

  const now = Date.now();
  const pendingByGame = new Map<string, any[]>();
  const seenByGame = new Map<string, Set<string>>();
  for (const [gameKey, seen] of toEntries(guild.seen)) {
    seenByGame.set(gameKey, new Set(Array.isArray(seen) ? seen.map(String) : []));
  }
  for (const [gameKey, arr] of toEntries(guild.pendingUpdates)) {
    if (hasGameFilter && !enabledSet.has(gameKey)) continue;
    const seenSet = seenByGame.get(gameKey) || new Set();
    const cleaned = normalizePendingUpdateArray(arr).filter((item: any) => {
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
    if (hasGameFilter && !enabledSet.has(gameKey)) continue;
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
    const gameKey = rotateAfter(keys, lastProcessedGameKey)[0] as string;
    const queue = pendingByGame.get(gameKey) || [];
    const next = queue.shift();
    if (!next) { pendingByGame.delete(gameKey); continue; }
    const game = resultByGameKey.get(gameKey)?.game || { name: gameKey };
    const claim = await claimSeenUpdate(String(guild._id), channel.id, gameKey, next.id);
    if (claim.matchedCount === 0) {
      if (queue.length) pendingByGame.set(gameKey, queue);
      else pendingByGame.delete(gameKey);
      continue;
    }
    try {
      // V9: prima trimitere pingeaza rolul (daca e setat), restul nu - anti-spam.
      const sendPayload: any = {
        embeds: [buildUpdateEmbed(game.name, next, guild.notificationMode || "detailed")]
      };
      if (sentCount === 0 && guild.notificationRoleId) {
        sendPayload.content = `<@&${guild.notificationRoleId}>`;
        sendPayload.allowedMentions = { roles: [guild.notificationRoleId] };
      }
      await channel.send(sendPayload);
      sentCount++;
      lastProcessedGameKey = gameKey;
      await sleepIfPositive(DISCORD_SEND_DELAY_MS);
    } catch (err: any) {
      await rollbackSeenUpdate(String(guild._id), gameKey, next.id).catch(() => null);
      if (isPermanentDiscordError(err)) {
        const reason = `Discord cod ${err.code}: ${transientErrorMessage(err)}`;
        await disableUpdatesForChannelError(String(guild._id), channel.id, reason).catch(() => null);
        logger("WARN", "CRON_UPDATES", `Disable updates pentru guild ${guild._id} - cod permanent`, reason);
        break;
      }
      next.attempts = (next.attempts || 0) + 1;
      if (next.attempts < PENDING_UPDATE_MAX_ATTEMPTS) queue.unshift(next);
      logger("WARN", "CRON_UPDATES", `Nu am putut trimite update pentru ${gameKey}`, transientErrorMessage(err));
      break;
    }
    if (queue.length) pendingByGame.set(gameKey, queue);
    else pendingByGame.delete(gameKey);
  }

  const pendingObject = mapToObject(pendingByGame);
  const setDoc: any = { pendingUpdates: pendingObject };
  if (lastProcessedGameKey) setDoc.lastProcessedGameKey = lastProcessedGameKey;
  await GuildModel.updateOne(
    { _id: guild._id, subscribed: true, notificationChannelId: channel.id },
    { $set: setDoc }
  );
}

function buildOptimizedGameList(allGames: any[], subscribedGuilds: any[]) {
  if (!Array.isArray(subscribedGuilds) || subscribedGuilds.length === 0) return allGames;

  const used = new Set();
  for (const guild of subscribedGuilds) {
    const filter = Array.isArray(guild.enabledGames) ? guild.enabledGames : [];
    if (filter.length === 0) return allGames;
    for (const key of filter) used.add(String(key).toLowerCase());
  }

  const filtered = allGames.filter(game => used.has(String(game.key).toLowerCase()));
  return filtered.length > 0 ? filtered : allGames;
}

async function checkForUpdates(client: any, games: any[], shouldAbort: (() => boolean) | null = null) {
  if (shouldAbort?.()) return;

  const guilds = await GuildModel.find({
    subscribed: true,
    notificationChannelId: { $ne: null },
    updatesInitializing: { $ne: true }
  }).lean();
  if (!guilds.length) return;

  const optimizedGames = buildOptimizedGameList(games, guilds);
  if (optimizedGames.length < games.length) {
    logger("INFO", "CRON_UPDATES", `Lista optimizata: ${optimizedGames.length}/${games.length} jocuri folosite de guild-uri`);
  }

  let latestResults;
  try {
    latestResults = await getLatestForAllGames(optimizedGames, shouldAbort);
    setUpdatesCache(latestResults);
  } catch (err: any) {
    logger("ERROR", "CRON_UPDATES", "Nu am putut prelua update-urile", transientErrorMessage(err));
    return;
  }
  if (shouldAbort?.()) return;

  await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild: any) => {
    if (!shouldAbort?.()) await processGuildUpdates(client, guild, latestResults);
  }, {
    errorLogger: (guild: any, err: any) => logger("WARN", "CRON_UPDATES", `Eroare procesare guild ${guild._id}`, transientErrorMessage(err))
  });
}

async function claimSeenDiscount(guildId: string, channelId: string, hash: string) {
  return withMongoRetry(() => GuildModel.updateOne(
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
    OP_UPDATE_OPTS
  ), { label: "claimSeenDiscount" });
}

async function rollbackSeenDiscount(guildId: string, hash: string) {
  return GuildModel.updateOne(
    { _id: guildId },
    { $pull: { seenDiscounts: hash } }
  );
}

// V11: indexul (hash -> snapshot) este derivat din array-ul `deals` returnat de
// fetchDeals si nu se schimba intre guild-uri in acelasi ciclu cron. WeakMap
// keyed pe referinta array-ului ne lasa sa hash-uim O data per ciclu (per
// currency), nu N x M unde N = numar de guild-uri.
const dealsHashIndexCache = new WeakMap<any[], { dealsByHash: Map<string, any>; orderedHashes: string[] }>();

function getDealsHashIndex(deals: any[]) {
  let cached = dealsHashIndexCache.get(deals);
  if (cached) return cached;
  const dealsByHash = new Map();
  const orderedHashes = [];
  for (const deal of deals) {
    const hash = dealHash(deal);
    if (!dealsByHash.has(hash)) {
      dealsByHash.set(hash, deal);
      orderedHashes.push(hash);
    }
  }
  cached = { dealsByHash, orderedHashes };
  dealsHashIndexCache.set(deals, cached);
  return cached;
}

async function disableDiscountsForChannelError(guildId: string, channelId: string, message: string) {
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
    OP_UPDATE_OPTS
  );
}

// V9: mentiune rol pe prima trimitere doar.
async function processGuildDiscounts(client: any, guild: any, deals: any[]) {
  const { channel, abort } = await resolveOutboundChannel({
    client,
    guild,
    channelId: guild.discountChannelId,
    context: "CRON_DISCOUNTS",
    disableFn: disableDiscountsForChannelError
  });
  if (abort) return;

  const seenSet = new Set(Array.isArray(guild.seenDiscounts) ? guild.seenDiscounts.map(String) : []);
  // V11: index-ul hash este partajat intre toate guild-urile in ciclul curent
  // prin WeakMap-ul de mai sus - pe deployment-uri cu N guild-uri reducem
  // hashing-ul de la N x M la M apeluri per ciclu cron per currency.
  const { dealsByHash, orderedHashes } = getDealsHashIndex(deals);
  const pending: any[] = [];
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
  for (const hash of orderedHashes) {
    if (seenSet.has(hash) || pendingHashes.has(hash)) continue;
    const deal = dealsByHash.get(hash);
    if (!deal || !dealPassesFilters(deal, guild)) continue;
    pending.push({ hash, snapshot: deal, lastSeenAt: new Date(), attempts: 0 });
    pendingHashes.add(hash);
    if (pending.length >= PENDING_DISCOUNTS_LIMIT) break;
  }

  const remaining: any[] = [];
  let sentCount = 0;
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    if (!item) continue;
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
      const sendPayload: any = {
        embeds: [buildDealEmbed(dealToSend, guild.notificationMode || "detailed", guild.currency || DEFAULT_CURRENCY)]
      };
      // V9: ping rol doar pe prima trimitere
      if (sentCount === 0 && guild.discountRoleId) {
        sendPayload.content = `<@&${guild.discountRoleId}>`;
        sendPayload.allowedMentions = { roles: [guild.discountRoleId] };
      }
      await channel.send(sendPayload);
      sentCount++;
      await sleepIfPositive(DISCORD_SEND_DELAY_MS);
    } catch (err: any) {
      if (claimed) await rollbackSeenDiscount(String(guild._id), item.hash).catch(() => null);
      if (isPermanentDiscordError(err)) {
        const reason = `Discord cod ${err.code}: ${transientErrorMessage(err)}`;
        await disableDiscountsForChannelError(String(guild._id), channel.id, reason).catch(() => null);
        logger("WARN", "CRON_DISCOUNTS", `Disable discounts pentru guild ${guild._id} - cod permanent`, reason);
        remaining.push(...pending.slice(i + 1));
        break;
      }
      const retry = { ...item, attempts: (item.attempts || 0) + 1 };
      if (retry.attempts < PENDING_DISCOUNT_MAX_ATTEMPTS) remaining.push(retry);
      remaining.push(...pending.slice(i + 1));
      logger("WARN", "CRON_DISCOUNTS", "Nu am putut trimite reducere", transientErrorMessage(err));
      break;
    }
  }

  await GuildModel.updateOne(
    { _id: guild._id, discountsSubscribed: true, discountChannelId: channel.id },
    { $set: { pendingDiscounts: remaining.slice(-PENDING_DISCOUNTS_LIMIT) } }
  );
}

async function checkForDiscounts(client: any, shouldAbort: (() => boolean) | null = null) {
  if (shouldAbort?.()) return;
  const guilds = await GuildModel.find({
    discountsSubscribed: true,
    discountChannelId: { $ne: null },
    discountsInitializing: { $ne: true }
  }).lean();
  if (!guilds.length) return;

  const dealsPromises = new Map<string, Promise<any[]>>();
  async function dealsForCurrency(currency: any): Promise<any[]> {
    const cur = normalizeCurrencyKey(currency);
    const cached = getDealsCacheData(cur);
    if (cached) return cached;
    if (!dealsPromises.has(cur)) {
      dealsPromises.set(cur, fetchDeals({ currency: cur, fromCron: true }).then((deals: any[]) => {
        setDealsCache(cur, deals);
        return deals;
      }));
    }
    return dealsPromises.get(cur) as Promise<any[]>;
  }

  await runConcurrent(guilds, GUILD_PROCESS_CONCURRENCY, async (guild: any) => {
    if (shouldAbort?.()) return;
    const currency = guild.currency || DEFAULT_CURRENCY;
    const deals = await dealsForCurrency(currency);
    await processGuildDiscounts(client, guild, deals);
  }, {
    errorLogger: (guild: any, err: any) => logger("WARN", "CRON_DISCOUNTS", `Eroare procesare guild ${guild._id}`, transientErrorMessage(err))
  });
}

  Object.assign(ctx, {
    DISCORD_PERMANENT_ERROR_CODES,
    isPermanentDiscordError,
    transientErrorMessage,
    resolveOutboundChannel,
    claimSeenUpdate,
    rollbackSeenUpdate,
    disableUpdatesForChannelError,
    processGuildUpdates,
    buildOptimizedGameList,
    checkForUpdates,
    claimSeenDiscount,
    rollbackSeenDiscount,
    disableDiscountsForChannelError,
    processGuildDiscounts,
    checkForDiscounts
  });
};
