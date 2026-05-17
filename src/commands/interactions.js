"use strict";

module.exports = (ctx) => {
  const {
    EmbedBuilder, MessageFlags, GuildModel, logger, getSystemTimes,
    saveSystemTimes, getGuildSettings, invalidateGuildCache, DEFAULT_CURRENCY,
    getCurrencyConfig, executeFetchWithCircuitBreaker, getLatestForAllGames,
    fetchDeals, enrichDealData, dealHash, searchSteamGameByName,
    chooseBestSteamMatch, fetchSteamPriceDetails, extractSteamOfferEndDate,
    httpReq, safeCheerioLoad, MAX_DEALS, truncate, COMMAND_OUTPUT_MAX_CHARS,
    DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS, setDealsCache, getUpdatesCacheData,
    setUpdatesCache, getDealsCacheData, cacheGetLRU, cacheSetLRU, cache,
    CACHE_TTL_MS, SINGLE_CACHE_MAX_SIZE, DLC_CACHE_MAX_SIZE, ITEMS_PER_PAGE,
    DLC_ITEMS_PER_PAGE, enforceCooldown, startCommandLog, safeDefer,
    safeEdit, findGameAndSuggestion, buildUpdateEmbed, buildDealEmbed,
    buildSteamPriceEmbed, handlePagination, dealPassesFilters, canSendEmbeds,
    missingChannelPermsMessage, makeActivationId, formatUserError, smoothTime,
    COLORS
  } = ctx;

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
        { upsert: true, ...OP_UPDATE_OPTS }
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
          OP_UPDATE_OPTS
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
          OP_UPDATE_OPTS
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
        { upsert: true, ...OP_UPDATE_OPTS }
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
          OP_UPDATE_OPTS
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
          OP_UPDATE_OPTS
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
      }, OP_UPDATE_OPTS);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: Update-uri oprite.");
    }
    if (sub === "reduceri") {
      await GuildModel.updateOne({ _id: guildId }, {
        $set: { discountsSubscribed: false, discountChannelId: null, discountsInitializing: false, pendingDiscounts: [] },
        $unset: { discountsActivationId: "" }
      }, OP_UPDATE_OPTS);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: Reduceri oprite.");
    }
  } catch (err) {
    return safeEdit(interaction, formatUserError(err, "Eroare la baza de date."));
  }
}

// V9: handler /set restructurat — dispatch pe subcommand group + handlere noi.
async function handleSetInteraction(interaction, games) {
  const guildId = interaction.guild.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  await safeDefer(interaction);

  if (group === "games") return handleSetGames(interaction, games, sub, guildId);
  if (group === "role") return handleSetRole(interaction, sub, guildId);

  // Subcomenzi directe (fără grup): mode, mindiscount, maxprice, free, paid, currency, stores
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
  } else if (sub === "maxprice") {
    const val = interaction.options.getInteger("value");
    updateDoc.maxAbsolutePrice = val;
    confirmMsg = val === 0
      ? "OK: Filtru pret maxim dezactivat."
      : `OK: Pret maxim setat: **${val}**`;
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
  } else if (sub === "stores") {
    const raw = String(interaction.options.getString("value") || "").trim().toLowerCase();
    if (raw === "reset" || raw === "") {
      updateDoc.enabledStores = [];
      confirmMsg = "OK: Filtru store-uri resetat (toate active).";
    } else {
      const tokens = raw.split(",").map(s => s.trim()).filter(Boolean);
      const selected = [];
      for (const t of tokens) {
        if (t === "steam") selected.push("Steam");
        else if (t === "epic" || t === "epicgames" || t === "epic games") selected.push("Epic Games");
        else {
          return safeEdit(interaction, `Eroare: Store necunoscut: \`${t}\`. Valori valide: \`steam\`, \`epic\`. Pentru reset: \`reset\`.`);
        }
      }
      updateDoc.enabledStores = Array.from(new Set(selected));
      confirmMsg = `OK: Store-uri active: **${updateDoc.enabledStores.join(", ")}**`;
    }
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

async function handleSetGames(interaction, games, sub, guildId) {
  if (sub === "list") {
    const guild = await getGuildSettings(guildId);
    const enabled = Array.isArray(guild?.enabledGames) ? guild.enabledGames : [];
    if (enabled.length === 0) {
      return safeEdit(interaction, "OK: Filtru per-joc: **dezactivat** (toate jocurile configurate sunt active).");
    }
    const lines = enabled.map(key => {
      const g = games.find(x => x.key === key);
      return g ? `- **${g.name}** (\`${g.key}\`)` : `- \`${key}\` *(cheie necunoscuta in config)*`;
    });
    return safeEdit(interaction, `OK: Jocuri active explicit (${enabled.length}):\n` + lines.join("\n"));
  }

  if (sub === "reset") {
    try {
      await GuildModel.updateOne({ _id: guildId }, { $set: { enabledGames: [] } }, { upsert: true });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: Filtru per-joc resetat. Toate jocurile sunt active.");
    } catch (err) {
      return safeEdit(interaction, formatUserError(err, "Eroare la resetare."));
    }
  }

  const joc = interaction.options.getString("joc");
  const game = games.find(g => g.key === joc);
  if (!game) {
    return safeEdit(interaction, `Eroare: Cheia \`${joc}\` nu exista in config. Foloseste \`/games\` pentru a vedea cheile valide.`);
  }

  try {
    if (sub === "add") {
      await GuildModel.updateOne(
        { _id: guildId },
        { $addToSet: { enabledGames: joc } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: **${game.name}** adaugat la lista activa.`);
    }
    if (sub === "remove") {
      await GuildModel.updateOne(
        { _id: guildId },
        { $pull: { enabledGames: joc } }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: **${game.name}** scos din lista activa.`);
    }
  } catch (err) {
    return safeEdit(interaction, formatUserError(err, "Eroare la modificarea listei de jocuri."));
  }
}

async function handleSetRole(interaction, sub, guildId) {
  const role = interaction.options.getRole("value", false);
  const field = sub === "updates" ? "notificationRoleId" : "discountRoleId";
  const label = sub === "updates" ? "update-uri" : "reduceri";
  try {
    if (role) {
      await GuildModel.updateOne({ _id: guildId }, { $set: { [field]: role.id } }, { upsert: true });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: Rol pentru ${label}: <@&${role.id}> *(ping doar la prima notificare per ciclu)*`);
    } else {
      await GuildModel.updateOne({ _id: guildId }, { $set: { [field]: null } });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: Rol pentru ${label} eliminat (fara ping).`);
    }
  } catch (err) {
    return safeEdit(interaction, formatUserError(err, "Eroare la setarea rolului."));
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
  const guild = await getGuildSettings(interaction.guild.id);
  const enabledGames = Array.isArray(guild?.enabledGames) ? guild.enabledGames : [];
  const enabledSet = enabledGames.length > 0 ? new Set(enabledGames) : null;
  const valid = data.filter(r => r.latest !== null && (!enabledSet || enabledSet.has(r.game.key)));
  if (!valid.length) {
    endLog("no_data");
    return safeEdit(
      interaction,
      enabledSet
        ? "Eroare: Nu am date disponibile pentru jocurile active ale acestui server."
        : "Eroare: Nu am date disponibile."
    );
  }
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
    // V9: trecem currency-ul pentru extractul de dată — locale corect per guild.
    const offerEndDate = gameData.price_overview?.discount_percent > 0
      ? await extractSteamOfferEndDate(bestMatch.id, currency)
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
      const cc = getCurrencyConfig(currency).cc;
      // V9: adăugăm l=english pentru consistență cu enrich.
      const htmlRes = await httpReq("GET", `https://store.steampowered.com/app/${bestMatch.id}?cc=${cc}&l=english`, {
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
        .setColor(COLORS.DLC)
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

// V9: autocomplete handler. Returnează maxim 25 sugestii, scoring simplu.
// Pentru /dlc și /latest pret folosim numele complet ca valoare (Steam search
// nu cunoaște cheia internă), pentru restul folosim cheia.
async function handleAutocomplete(interaction, games) {
  try {
    const focused = interaction.options.getFocused(true);
    if (!focused || focused.name !== "joc") {
      return interaction.respond([]).catch(() => null);
    }
    const input = String(focused.value || "").toLowerCase().trim().substring(0, 100);
    const cmd = interaction.commandName;
    const sub = interaction.options.getSubcommand(false);
    const group = interaction.options.getSubcommandGroup(false);

    // Pentru Steam search (dlc, latest pret) returnăm numele complet
    const useNameAsValue = (cmd === "dlc") || (cmd === "latest" && sub === "pret");

    // Pentru /set games remove restrângem pool-ul la jocurile deja active
    let pool = games;
    if (cmd === "set" && group === "games" && sub === "remove") {
      try {
        const guild = await getGuildSettings(interaction.guild.id);
        const enabled = Array.isArray(guild?.enabledGames) ? guild.enabledGames : [];
        if (enabled.length > 0) {
          const enabledSet = new Set(enabled);
          pool = games.filter(g => enabledSet.has(g.key));
        }
      } catch (err) {
        logger("WARN", "AUTOCOMPLETE", "Nu am putut citi setarile guild-ului", err.message);
      }
    }

    const candidates = [];
    for (const game of pool) {
      const haystack = [
        String(game.name || "").toLowerCase(),
        String(game.key || "").toLowerCase(),
        ...(Array.isArray(game.aliases) ? game.aliases.map(a => String(a).toLowerCase()) : [])
      ];
      let score = -1;
      for (const h of haystack) {
        if (!input) { score = Math.max(score, 0); continue; }
        if (h === input) score = Math.max(score, 100);
        else if (h.startsWith(input)) score = Math.max(score, 50);
        else if (h.includes(input)) score = Math.max(score, 20);
      }
      // Dacă utilizatorul a introdus ceva, filtrăm scorurile prea slabe
      if (input && score < 20) continue;
      candidates.push({ game, score });
    }
    candidates.sort((a, b) => b.score - a.score);

    const choices = candidates.slice(0, 25).map(c => ({
      name: `${c.game.name} (${c.game.key})`.substring(0, 100),
      value: (useNameAsValue ? c.game.name : c.game.key).substring(0, 100)
    }));
    await interaction.respond(choices).catch(() => null);
  } catch (err) {
    logger("WARN", "AUTOCOMPLETE", "Eroare in handler", err.message);
    interaction.respond([]).catch(() => null);
  }
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle("Meniul de Ajutor - Big Master")
    .setDescription("Toate comenzile sunt slash commands. Incepe cu `/` pentru autocomplete.")
    .addFields(
      { name: "Utilitare", value: "`/ping` - `/games` - `/help`" },
      { name: "Notificari Automate (admin)", value: "`/start updates` - `/stop updates`\n`/start reduceri` - `/stop reduceri`" },
      {
        name: "Preferinte Server (admin)",
        value:
          "`/set mode <compact|detailed>`\n" +
          "`/set mindiscount <0-100>`\n" +
          "`/set maxprice <0-10000>` *(0 = fara limita)*\n" +
          "`/set free <on|off>` - `/set paid <on|off>`\n" +
          "`/set currency <USD|EUR|GBP|RON>`\n" +
          "`/set stores <steam,epic | reset>`"
      },
      {
        name: "Filtru per-joc (admin)",
        value:
          "`/set games add <joc>` - `/set games remove <joc>`\n" +
          "`/set games list` - `/set games reset`"
      },
      {
        name: "Ping-uri rol (admin)",
        value:
          "`/set role updates <rol>` *(gol = oprit)*\n" +
          "`/set role discounts <rol>` *(gol = oprit)*"
      },
      {
        name: "Comenzi Manuale",
        value: "`/latest updates` - `/latest reduceri`\n`/latest update <joc>` - `/latest pret <joc>`\n`/dlc <joc>` - `/status <joc>`"
      }
    );
}

async function handleInteraction(interaction, games) {
  // V9: branch autocomplete
  if (interaction.isAutocomplete && interaction.isAutocomplete()) {
    return handleAutocomplete(interaction, games);
  }
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
    if (cmd === "set") return handleSetInteraction(interaction, games);
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

  Object.assign(ctx, {
    handlePingInteraction,
    handleGamesInteraction,
    handleHelpInteraction,
    handleStartInteraction,
    handleStopInteraction,
    handleSetInteraction,
    handleSetGames,
    handleSetRole,
    handleLatestInteraction,
    handleLatestUpdatesInteraction,
    handleLatestDealsInteraction,
    handleLatestSingleInteraction,
    handlePriceSearchInteraction,
    handleDlcInteraction,
    handleStatusInteraction,
    handleAutocomplete,
    buildHelpEmbed,
    handleInteraction
  });
};
