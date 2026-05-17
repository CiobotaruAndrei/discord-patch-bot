"use strict";

module.exports = (ctx) => {
  const {
    crypto, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, MessageFlags, logger, checkUserCooldown, COLORS,
    truncate, DEFAULT_CURRENCY, formatPrice, COLLECTOR_TIMEOUT_MS,
    MAX_FUZZY_SEARCH_INPUT, levenshtein, httpReq
  } = ctx;

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
    .setColor(COLORS.SUCCESS)
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

// V9: fix "Users **Popularitate:**" leftover + scoatere "Se incarca:" eronat.
function buildDealEmbed(deal, mode = "detailed", currency) {
  const cur = currency || deal.currency || DEFAULT_CURRENCY;
  const isFree = parseFloat(deal.salePrice) === 0;
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder()
    .setColor(isFree ? COLORS.FREE : COLORS.ERROR)
    .setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));
  if (deal.link) embed.setURL(deal.link);
  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~${formatPrice(deal.normalPrice, cur)}~~ -> **${isFree ? "GRATUIT" : formatPrice(deal.salePrice, cur)}**\n[Apasa aici pentru link](${deal.link})`);
    return embed;
  }
  let statsStr = "";
  if (deal.qualityScore > 0) {
    statsStr = `**Calitate:** ${deal.qualityScore}% aprecieri | **Popularitate:** ${deal.totalReviews > 0 ? `${deal.totalReviews} recenzii` : "Top Seller"}\n\n`;
  }
  embed.setAuthor({ name: truncate(deal.store, 256) })
    .setDescription(truncate(`**${deal.store}** ofera o reducere de **${deal.savings}%**!\n\n`
      + statsStr + (deal.endDateStr && deal.endDateStr !== "Nespecificat"
        ? `**${isFree ? "Gratis pana la" : "Expira la"}:** ${deal.endDateStr}\n\n`
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
  let color = COLORS.INFO;

  if (game.type === "epic_games") {
    try {
      const res = await httpReq("GET", "https://status.epicgames.com/api/v2/status.json");
      statusText = `**Status Server:** ${res.data.status.description}`;
      statusLink = "https://status.epicgames.com/";
      color = res.data.status.indicator === "none" ? COLORS.POSITIVE : COLORS.ERROR;
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

// V9: fix "Se incarca:" leftover din descriere.
function buildSteamPriceEmbed(gameData, appId, offerEndDate, currency) {
  const cur = currency || DEFAULT_CURRENCY;
  const typeStr = gameData.type === "game" ? "Joc"
    : gameData.type === "dlc" ? "DLC / Extensie"
    : gameData.type === "music" ? "Coloana Sonora"
    : gameData.type === "demo" ? "Demo" : "Aplicatie/Bundle";
  const priceOverview = gameData.price_overview;
  let embedDesc = `**Tip produs:** ${typeStr}\n\n`;
  let color = COLORS.DARK;

  if (gameData.is_free) {
    embedDesc += "Acest titlu este in prezent **GRATUIT** (Free to Play).";
    color = COLORS.FREE;
  } else if (!priceOverview) {
    embedDesc += "Pretul nu este disponibil in acest moment.";
  } else {
    const normalPrice = (priceOverview.initial / 100).toFixed(2);
    const currentPrice = (priceOverview.final / 100).toFixed(2);
    if (priceOverview.discount_percent > 0) {
      embedDesc += `Este o reducere activa de **${priceOverview.discount_percent}%**!\n\n~~${formatPrice(normalPrice, cur)}~~ -> **${formatPrice(currentPrice, cur)}**`;
      embedDesc += `\n**Oferta expira la:** ${offerEndDate || "Nespecificat"}`;
      color = COLORS.ERROR;
    } else {
      embedDesc += `Nu este la reducere in acest moment.\n\nPret standard: **${formatPrice(normalPrice, cur)}**`;
      color = COLORS.SUCCESS;
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

  Object.assign(ctx, {
    enforceCooldown,
    startCommandLog,
    safeDefer,
    safeEdit,
    buildUpdateEmbed,
    buildDealEmbed,
    generateSessionId,
    buildPaginationButtons,
    handlePagination,
    findGameAndSuggestion,
    fetchGameStatus,
    buildSteamPriceEmbed
  });
};
