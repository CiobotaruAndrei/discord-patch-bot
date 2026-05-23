import type { DealInfo, GameConfig, NormalizedUpdate, NotificationMode } from "../../types";
import { findGameKeys } from "../../native/fuzzy";
import { errorMessage } from "../../shared/errors";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

type FindGameResult = {
  game: GameConfig | null;
  suggestion: GameConfig | null;
};

type CommandUiContext = {
  crypto: {
    randomBytes(size: number): { toString(encoding: BufferEncoding): string };
  };
  EmbedBuilder: any;
  ActionRowBuilder: any;
  ButtonBuilder: any;
  ButtonStyle: any;
  ComponentType: any;
  MessageFlags: any;
  logger: Logger;
  checkUserCooldown(userId: unknown, command: string): { allowed: boolean; remainingMs?: number };
  COLORS: Record<string, number>;
  truncate(value: unknown, maxLen: number): string;
  DEFAULT_CURRENCY: string;
  formatPrice(value: unknown, currencyCode?: string): string;
  COLLECTOR_TIMEOUT_MS: number;
  MAX_FUZZY_SEARCH_INPUT: number;
  httpReq(method: string, url: string, options?: Record<string, unknown>): Promise<any>;
  [key: string]: unknown;
};

function attachCommandUi(ctx: CommandUiContext): void {
  const {
    crypto, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, MessageFlags, logger, checkUserCooldown, COLORS,
    truncate, DEFAULT_CURRENCY, formatPrice, COLLECTOR_TIMEOUT_MS,
    MAX_FUZZY_SEARCH_INPUT, httpReq
  } = ctx;

async function enforceCooldown(interaction: any, command: string): Promise<boolean> {
  const { allowed, remainingMs = 0 } = checkUserCooldown(interaction.user?.id, command);
  if (allowed) return true;
  const msg = `Cooldown: Comanda \`${command}\` are cooldown. Reincearca in **${Math.ceil(remainingMs / 1000)}s**.`;
  if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => null);
  else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
  return false;
}

function startCommandLog(interaction: any, command: string, extra: Record<string, unknown> = {}): CommandLogEnd {
  const startedAt = Date.now();
  logger("INFO", "USER_CMD", `Comanda pornita: ${command}`, {
    userId: interaction.user?.id,
    guildId: interaction.guild?.id,
    channelId: interaction.channel?.id,
    command,
    ...extra
  });
  return (status = "ok", endExtra: Record<string, unknown> = {}) => {
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

async function safeDefer(interaction: any, ephemeral = false): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }
  } catch (err) {
    logger("WARN", "INTERACTION", "Eroare la deferReply", errorMessage(err));
  }
}

async function safeEdit(interaction: any, payload: unknown): Promise<unknown | null> {
  try { return await interaction.editReply(payload); }
  catch (err) {
    logger("WARN", "INTERACTION", "Eroare la editReply", errorMessage(err));
    return null;
  }
}

function buildUpdateEmbed(gameName: string, latest: NormalizedUpdate, mode: NotificationMode = "detailed"): any {
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

function buildDealEmbed(deal: DealInfo, mode: NotificationMode = "detailed", currency?: string): any {
  const cur = currency || deal.currency || DEFAULT_CURRENCY;
  const isFree = parseFloat(String(deal.salePrice)) === 0;
  const isCompact = mode === "compact";
  const embed = new EmbedBuilder()
    .setColor(isFree ? COLORS.FREE : COLORS.ERROR)
    .setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));
  if (deal.link) embed.setURL(deal.link);
  if (isCompact) {
    embed.setDescription(`**${deal.store}** | ~~${formatPrice(deal.normalPrice, String(cur))}~~ -> **${isFree ? "GRATUIT" : formatPrice(deal.salePrice, String(cur))}**\n[Apasa aici pentru link](${deal.link})`);
    return embed;
  }
  let statsStr = "";
  if (Number(deal.qualityScore) > 0) {
    statsStr = `**Calitate:** ${deal.qualityScore}% aprecieri | **Popularitate:** ${Number(deal.totalReviews) > 0 ? `${deal.totalReviews} recenzii` : "Top Seller"}\n\n`;
  }
  embed.setAuthor({ name: truncate(deal.store, 256) })
    .setDescription(truncate(`**${deal.store}** ofera o reducere de **${deal.savings}%**!\n\n`
      + statsStr + (deal.endDateStr && deal.endDateStr !== "Nespecificat"
        ? `**${isFree ? "Gratis pana la" : "Expira la"}:** ${deal.endDateStr}\n\n`
        : ""), 4096))
    .addFields(
      { name: "Pret Vechi", value: `~~${formatPrice(deal.normalPrice, String(cur))}~~`, inline: true },
      { name: "Pret Nou", value: isFree ? "GRATUIT" : formatPrice(deal.salePrice, String(cur)), inline: true },
      { name: "Link", value: `[Apasa aici](${deal.link})`, inline: false }
    );
  if (typeof deal.thumbnail === "string" && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
  if (deal.extraDetails) embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails.trim(), 1024), inline: false });
  return embed;
}

function generateSessionId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function buildPaginationButtons(prefix: string, sessionId: string, page: number, totalPages: number): any {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("<- Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm ->").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(
  interactionMessage: any,
  authorId: string,
  prefix: string,
  items: unknown[],
  itemsPerPage: number,
  generateEmbedsFn: (currentPage: number, totalPages: number, mode: NotificationMode) => Promise<unknown[]> | unknown[],
  defaultMode: NotificationMode = "detailed"
): Promise<void> {
  if (!items || items.length === 0) return;
  let currentPage = 0;
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const sessionId = generateSessionId();
  let collector: any = null;

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
  collector.on("collect", async (btn: any) => {
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

const FIND_GAME_CACHE_MAX = 200;
const findGameCache = new Map<string, FindGameResult>();
const findGameCacheGuard: {
  hash: string;
  gamesRef: GameConfig[] | null;
  gamesByKey: Map<string, GameConfig>;
} = { hash: "", gamesRef: null, gamesByKey: new Map() };

function refreshGuard(games: GameConfig[]): string {
  if (findGameCacheGuard.gamesRef === games && findGameCacheGuard.hash) {
    return findGameCacheGuard.hash;
  }
  if (findGameCacheGuard.hash) findGameCache.clear();
  const hash = games.map(game => String(game.key)).join("|");
  const byKey = new Map<string, GameConfig>();
  for (const game of games) byKey.set(String(game.key), game);
  findGameCacheGuard.hash = hash;
  findGameCacheGuard.gamesRef = games;
  findGameCacheGuard.gamesByKey = byKey;
  return hash;
}

function rememberFindGameResult(cacheKey: string, result: FindGameResult): FindGameResult {
  if (findGameCache.size >= FIND_GAME_CACHE_MAX) {
    const oldest = findGameCache.keys().next().value;
    if (oldest !== undefined) findGameCache.delete(oldest);
  }
  findGameCache.set(cacheKey, result);
  return result;
}

function findGameAndSuggestion(text: unknown, games: GameConfig[]): FindGameResult {
  const hash = refreshGuard(games);
  const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim().slice(0, MAX_FUZZY_SEARCH_INPUT);
  const cacheKey = `${hash}::${search}`;
  const cached = findGameCache.get(cacheKey);
  if (cached !== undefined) {
    findGameCache.delete(cacheKey);
    findGameCache.set(cacheKey, cached);
    return cached;
  }

  const { gameKey, suggestionKey } = findGameKeys(text, games, MAX_FUZZY_SEARCH_INPUT);
  const lookup = findGameCacheGuard.gamesByKey;
  const result: FindGameResult = {
    game: gameKey ? lookup.get(gameKey) || null : null,
    suggestion: suggestionKey ? lookup.get(suggestionKey) || null : null
  };
  return rememberFindGameResult(cacheKey, result);
}

function getFindGameCacheSize(): number {
  return findGameCache.size;
}

function clearFindGameCache(): void {
  findGameCache.clear();
  findGameCacheGuard.hash = "";
  findGameCacheGuard.gamesRef = null;
  findGameCacheGuard.gamesByKey = new Map();
}

async function fetchGameStatus(game: GameConfig): Promise<any> {
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
      // V11: nu mai inghitim eroarea fara urma — log-am ca sa observam daca
      // status.epicgames.com a schimbat shape-ul JSON sau pica frecvent.
      logger("WARN", "STATUS", "Esec status.epicgames.com, folosesc fallback", errorMessage(err));
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
      // V11: marker-ul de italic `*(...)` era lasat deschis si Discord randa fie
      // un asterisc literal, fie continua italic-ul peste continutul urmator.
      value: `[Acceseaza homepage](${homepageLink})\n*(Acesta nu este un API live de status.)*`
    });
  }
  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}

function buildSteamPriceEmbed(gameData: any, appId: string | number, offerEndDate?: string | null, currency?: string): any {
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
    getFindGameCacheSize,
    clearFindGameCache,
    fetchGameStatus,
    buildSteamPriceEmbed
  });
}

export = attachCommandUi;
