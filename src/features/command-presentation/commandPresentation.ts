import type { DealInfo, GameConfig, NormalizedUpdate, NotificationMode } from "../../types";
import { findGameKeys } from "../../native/fuzzy";
import { errorMessage } from "../../shared/errors";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

interface ChainableEmbed {
  setColor(value: unknown): this;
  setTitle(value: unknown): this;
  setFooter(value: unknown): this;
  setURL(value: unknown): this;
  setDescription(value: unknown): this;
  setImage(value: unknown): this;
  setThumbnail(value: unknown): this;
  setTimestamp(value: unknown): this;
  setAuthor(value: unknown): this;
  addFields(...fields: unknown[]): this;
}

interface ButtonComponent {
  setCustomId(value: string): this;
  setLabel(value: string): this;
  setStyle(value: unknown): this;
  setDisabled(value: boolean): this;
}

interface ActionRowComponent {
  addComponents(...components: unknown[]): this;
}

interface ComponentCollector {
  on(event: "collect", listener: (button: ButtonInteraction) => unknown): this;
  on(event: "end", listener: () => unknown): this;
  stop(reason?: string): void;
}

interface InteractionMessage {
  editable?: boolean;
  edit(payload: unknown): Promise<unknown>;
  createMessageComponentCollector(options: unknown): ComponentCollector;
}

interface ButtonInteraction {
  user: { id: string };
  customId: string;
  reply(payload: unknown): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
}

interface DiscordInteraction {
  user?: { id?: unknown };
  guild?: { id?: unknown };
  channel?: { id?: unknown };
  deferred?: boolean;
  replied?: boolean;
  deferReply(payload?: unknown): Promise<unknown>;
  editReply(payload: unknown): Promise<unknown>;
  reply(payload: unknown): Promise<unknown>;
}

interface HttpResponse<T = unknown> {
  data: T;
}

interface EpicStatusPayload {
  status?: {
    description?: string;
    indicator?: string;
  };
}

interface SteamPriceOverview {
  initial: number;
  final: number;
  discount_percent: number;
}

interface SteamAppDetails {
  type?: string;
  price_overview?: SteamPriceOverview | null;
  is_free?: boolean;
  name?: string;
  header_image?: string;
}

type FindGameResult = {
  game: GameConfig | null;
  suggestion: GameConfig | null;
};

type CommandUiDeps = {
  crypto: {
    randomBytes(size: number): { toString(encoding: BufferEncoding): string };
  };
  EmbedBuilder: new () => ChainableEmbed;
  ActionRowBuilder: new () => ActionRowComponent;
  ButtonBuilder: new () => ButtonComponent;
  ButtonStyle: { Primary: unknown; Secondary: unknown };
  ComponentType: { Button: unknown };
  MessageFlags: { Ephemeral: number };
  logger: Logger;
  checkUserCooldown(userId: unknown, command: string): { allowed: boolean; remainingMs?: number };
  COLORS: Record<string, number>;
  truncate(value: unknown, maxLen: number): string;
  DEFAULT_CURRENCY: string;
  formatPrice(value: unknown, currencyCode?: string): string;
  COLLECTOR_TIMEOUT_MS: number;
  MAX_FUZZY_SEARCH_INPUT: number;
  httpReq(method: string, url: string, options?: Record<string, unknown>): Promise<HttpResponse>;
};

type CommandUiContext = CommandUiDeps & Record<string, unknown>;

function createCommandPresentation(deps: CommandUiDeps) {
  const {
    crypto, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, MessageFlags, logger, checkUserCooldown, COLORS,
    truncate, DEFAULT_CURRENCY, formatPrice, COLLECTOR_TIMEOUT_MS,
    MAX_FUZZY_SEARCH_INPUT, httpReq
  } = deps;

async function enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean> {
  const { allowed, remainingMs = 0 } = checkUserCooldown(interaction.user?.id, command);
  if (allowed) return true;
  const msg = `Cooldown: Comanda \`${command}\` are cooldown. Reincearca in **${Math.ceil(remainingMs / 1000)}s**.`;
  if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => null);
  else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
  return false;
}

function startCommandLog(interaction: DiscordInteraction, command: string, extra: Record<string, unknown> = {}): CommandLogEnd {
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

async function safeDefer(interaction: DiscordInteraction, ephemeral = false): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }
  } catch (err) {
    logger("WARN", "INTERACTION", "Eroare la deferReply", errorMessage(err));
  }
}

async function safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown | null> {
  try { return await interaction.editReply(payload); }
  catch (err) {
    logger("WARN", "INTERACTION", "Eroare la editReply", errorMessage(err));
    return null;
  }
}

function buildUpdateEmbed(gameName: string, latest: NormalizedUpdate, mode: NotificationMode = "detailed"): ChainableEmbed {
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

function buildDealEmbed(deal: DealInfo, mode: NotificationMode = "detailed", currency?: string): ChainableEmbed {
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

  const qualityNum = Number(deal.qualityScore);
  const reviewsNum = Number(deal.totalReviews);
  const savingsNum = Number(deal.savings);
  const savingsDisplay = Number.isFinite(savingsNum) ? Math.min(100, Math.max(0, Math.round(savingsNum))) : 0;
  let statsStr = "";
  if (Number.isFinite(qualityNum) && qualityNum > 0) {
    const popularity = Number.isFinite(reviewsNum) && reviewsNum > 0 ? `${reviewsNum} recenzii` : "Top Seller";
    statsStr = `**Calitate:** ${Math.round(qualityNum)}% aprecieri | **Popularitate:** ${popularity}\n\n`;
  }
  embed.setAuthor({ name: truncate(deal.store, 256) })
    .setDescription(truncate(`**${deal.store}** ofera o reducere de **${savingsDisplay}%**!\n\n`
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

function buildPaginationButtons(prefix: string, sessionId: string, page: number, totalPages: number): ActionRowComponent {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("<- Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm ->").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
  );
}

async function handlePagination(
  interactionMessage: InteractionMessage,
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
  let collector: ComponentCollector | null = null;

  const updateMessage = async (): Promise<boolean> => {
    try {
      const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
      await interactionMessage.edit({
        embeds,
        components: [buildPaginationButtons(prefix, sessionId, currentPage, totalPages)]
      }).catch((err: unknown) => {
        logger("WARN", "PAGINATION", `Eroare la edit-ul paginii (prefix=${prefix})`, errorMessage(err));
      });
      return true;
    } catch (err) {
      logger("WARN", "PAGINATION", `Eroare la generarea embed-urilor (prefix=${prefix})`, errorMessage(err));
      if (collector) collector.stop("error");
      return false;
    }
  };

  if (!(await updateMessage())) return;
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
    if (interactionMessage.editable) {
      interactionMessage.edit({ components: [] }).catch((err: unknown) => {
        logger("WARN", "PAGINATION", `Eroare la cleanup-ul butoanelor (prefix=${prefix})`, errorMessage(err));
      });
    }
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

async function fetchGameStatus(game: GameConfig): Promise<ChainableEmbed> {
  let statusText = "Nu am un API oficial live integrat pentru acest joc. Iti dau pagina oficiala/fallback ca sa verifici manual.";
  let statusLink = "";
  let homepageLink = "";
  let color = COLORS.INFO;

  if (game.type === "epic_games") {
    try {
      const res = await httpReq("GET", "https://status.epicgames.com/api/v2/status.json");
      const data = res.data as EpicStatusPayload;
      statusText = `**Status Server:** ${data.status?.description || "necunoscut"}`;
      statusLink = "https://status.epicgames.com/";
      color = data.status?.indicator === "none" ? COLORS.POSITIVE : COLORS.ERROR;
    } catch (err) {
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
      value: `[Acceseaza homepage](${homepageLink})\n*(Acesta nu este un API live de status.)*`
    });
  }
  if (game.thumbnail) embed.setThumbnail(game.thumbnail);
  return embed;
}

function buildSteamPriceEmbed(gameData: SteamAppDetails, appId: string | number, offerEndDate?: string | null, currency?: string): ChainableEmbed {
  const cur = currency || DEFAULT_CURRENCY;
  const typeStr = gameData.type === "game" ? "Joc"
    : gameData.type === "dlc" ? "DLC / Extensie"
    : gameData.type === "music" ? "Coloana Sonora"
    : gameData.type === "demo" ? "Demo" : "Aplicatie/Bundle";
  const priceOverview = gameData.price_overview;
  let embedDesc = `**Tip produs:** ${typeStr}\n\n`;
  let color = COLORS.DARK;

  const initialRaw = priceOverview ? Number(priceOverview.initial) : NaN;
  const finalRaw = priceOverview ? Number(priceOverview.final) : NaN;
  const pricesValid = Number.isFinite(initialRaw) && Number.isFinite(finalRaw);
  if (gameData.is_free) {
    embedDesc += "Acest titlu este in prezent **GRATUIT** (Free to Play).";
    color = COLORS.FREE;
  } else if (!priceOverview || !pricesValid) {
    embedDesc += "Pretul nu este disponibil in acest moment.";
  } else {
    const normalPrice = (initialRaw / 100).toFixed(2);
    const currentPrice = (finalRaw / 100).toFixed(2);
    const rawDiscount = Number(priceOverview.discount_percent);
    const discountPct = Number.isFinite(rawDiscount) && rawDiscount > 0
      ? rawDiscount
      : (initialRaw > finalRaw ? Math.round(((initialRaw - finalRaw) / initialRaw) * 100) : 0);
    if (discountPct > 0) {
      embedDesc += `Este o reducere activa de **${discountPct}%**!\n\n~~${formatPrice(normalPrice, cur)}~~ -> **${formatPrice(currentPrice, cur)}**`;
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

  return {
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
  };
}

type CommandUiInstaller = ((target: CommandUiContext) => void) & {
  createCommandPresentation: typeof createCommandPresentation;
};

const attachCommandUi = ((target: CommandUiContext): void => {
  const deps: CommandUiDeps = {
    crypto: target.crypto,
    EmbedBuilder: target.EmbedBuilder,
    ActionRowBuilder: target.ActionRowBuilder,
    ButtonBuilder: target.ButtonBuilder,
    ButtonStyle: target.ButtonStyle,
    ComponentType: target.ComponentType,
    MessageFlags: target.MessageFlags,
    logger: target.logger,
    checkUserCooldown: target.checkUserCooldown,
    COLORS: target.COLORS,
    truncate: target.truncate,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    formatPrice: target.formatPrice,
    COLLECTOR_TIMEOUT_MS: target.COLLECTOR_TIMEOUT_MS,
    MAX_FUZZY_SEARCH_INPUT: target.MAX_FUZZY_SEARCH_INPUT,
    httpReq: target.httpReq
  };
  Object.assign(target, createCommandPresentation(deps));
}) as CommandUiInstaller;

attachCommandUi.createCommandPresentation = createCommandPresentation;

export = attachCommandUi;
