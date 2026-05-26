"use strict";

/**
 * V12: handler tipat pentru `/latest *` (updates / reduceri / update <joc> /
 * pret <joc>).
 *
 * Continuare a splitting-ului review-ului extern: scoate cele 4 sub-comenzi
 * `/latest` plus dispatcher-ul din `legacyInteractionRouter.ts` intr-o factory
 * cu dependinte explicite, simetric cu `setInteractionHandler`,
 * `statusInteractionHandler`, `dlcInteractionHandler`.
 *
 * Versiunea legacy ramane shadow-ed in `legacyInteractionRouter.ts` pana cand
 * decidem sa o stergem; install chain-ul intercepteaza /latest aici, asa ca
 * dispatch-ul din legacy nu mai este atins.
 */

const { errorMessage, errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id: string };
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  options: {
    getSubcommand(): string;
    getString(name: string): string | null;
  };
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;
type NotificationMode = "compact" | "detailed";

interface UpdateRecord {
  game: GameConfig;
  latest: { id: string } & Record<string, unknown> | null;
}

interface SystemTimes {
  all?: number;
  single?: number;
  reduceri?: number;
}

interface GuildSettingsLite {
  enabledGames?: string[];
  notificationMode?: NotificationMode;
  currency?: string;
}

type CacheEntry<T> = { data: T; expiresAt: number };
type SingleCache = Map<string, CacheEntry<unknown>>;

type LatestHandlerDeps = {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown | null>;
  // updates path
  getUpdatesCacheData: () => UpdateRecord[] | null;
  setUpdatesCache: (data: UpdateRecord[]) => void;
  getLatestForAllGames: (games: GameConfig[]) => Promise<UpdateRecord[]>;
  // deals path
  getDealsCacheData: (currency: string) => unknown[] | null;
  setDealsCache: (currency: string, deals: unknown[]) => void;
  fetchDeals: (opts: { currency: string }) => Promise<unknown[]>;
  enrichDealData: (deal: unknown, currency: string) => Promise<unknown>;
  dealPassesFilters: (deal: unknown, guild: GuildSettingsLite | null) => boolean;
  // single-game path
  findGameAndSuggestion: (query: string, games: GameConfig[]) => { game: GameConfig | null; suggestion: GameConfig | null };
  executeFetchWithCircuitBreaker: (game: GameConfig) => Promise<{ latest?: unknown; error?: string }>;
  cache: { single: SingleCache };
  cacheGetLRU: <T>(map: Map<string, CacheEntry<T>>, key: string) => T | null;
  cacheSetLRU: <T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number, maxSize: number) => void;
  CACHE_TTL_MS: number;
  SINGLE_CACHE_MAX_SIZE: number;
  // price path
  searchSteamGameByName: (query: string, currency: string) => Promise<Array<{ id?: string | number; name?: string }>>;
  chooseBestSteamMatch: (
    items: Array<{ id?: string | number; name?: string }>,
    query: string,
    options?: { forceGameOnly?: boolean }
  ) => { id?: string | number } | null;
  fetchSteamPriceDetails: (appId: string | number, currency: string) => Promise<{
    price_overview?: { discount_percent?: number };
  } | null>;
  extractSteamOfferEndDate: (appId: string | number, currency: string) => Promise<string | null>;
  buildSteamPriceEmbed: (gameData: unknown, appId: string | number, offerEndDate: string | null, currency: string) => unknown;
  // common
  getSystemTimes: () => Promise<SystemTimes>;
  saveSystemTime: (key: string, value: number) => Promise<unknown>;
  smoothTime: (estimate: number, actual: number) => number;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  // embeds + pagination
  buildUpdateEmbed: (gameName: string, latest: unknown, mode: NotificationMode) => { setFooter: (opts: { text: string }) => unknown };
  buildDealEmbed: (deal: unknown, mode: NotificationMode, currency: string) => { setFooter: (opts: { text: string }) => unknown };
  handlePagination: (
    msg: unknown,
    authorId: string,
    prefix: string,
    items: unknown[],
    itemsPerPage: number,
    generateEmbedsFn: (page: number, totalP: number, mode: NotificationMode) => Promise<unknown[]> | unknown[],
    defaultMode?: NotificationMode
  ) => Promise<void>;
  // constants
  DEFAULT_CURRENCY: string;
  ITEMS_PER_PAGE: number;
  MAX_DEALS: number;
  MessageFlags: { Ephemeral: number };
};

type LatestContext = LatestHandlerDeps & { handleInteraction?: NextInteractionHandler };

function createLatestInteractionHandler(deps: LatestHandlerDeps) {
  const {
    logger, enforceCooldown, startCommandLog, safeDefer, safeEdit,
    getUpdatesCacheData, setUpdatesCache, getLatestForAllGames,
    getDealsCacheData, setDealsCache, fetchDeals, enrichDealData, dealPassesFilters,
    findGameAndSuggestion, executeFetchWithCircuitBreaker,
    cache, cacheGetLRU, cacheSetLRU, CACHE_TTL_MS, SINGLE_CACHE_MAX_SIZE,
    searchSteamGameByName, chooseBestSteamMatch, fetchSteamPriceDetails,
    extractSteamOfferEndDate, buildSteamPriceEmbed,
    getSystemTimes, saveSystemTime, smoothTime,
    getGuildSettings, formatUserError,
    buildUpdateEmbed, buildDealEmbed, handlePagination,
    DEFAULT_CURRENCY, ITEMS_PER_PAGE, MAX_DEALS, MessageFlags
  } = deps;

  async function handleLatestUpdatesInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
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
        // V11: dot-path write — fara lost-write race intre comenzi paralele
        // care actualizeaza chei diferite din SystemTimes.
        await saveSystemTime("all", smoothTime(estMs, Date.now() - startTime));
      } catch (err: unknown) {
        endLog("error", { errorMsg: errorMessage(err) });
        return safeEdit(interaction, formatUserError(err, "Nu am reusit sa obtin update-urile.", "ERR_LATEST_UPDATES"));
      }
    }
    const guildId = interaction.guild?.id;
    const guild = guildId ? await getGuildSettings(guildId) : null;
    const enabledGames = Array.isArray(guild?.enabledGames) ? guild!.enabledGames! : [];
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
    const mode: NotificationMode = guild?.notificationMode || "detailed";
    const msg = await safeEdit(interaction, "OK: Date incarcate!");
    const generateEmbeds = async (page: number, totalP: number, currentMode: NotificationMode) =>
      valid.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map((r) =>
        buildUpdateEmbed(r.game.name, r.latest, currentMode).setFooter({ text: `${r.game.name} - Pagina ${page + 1}/${totalP}` })
      );
    endLog("ok", { resultCount: valid.length });
    if (msg && interaction.user) {
      await handlePagination(msg, interaction.user.id, "upd", valid, ITEMS_PER_PAGE, generateEmbeds, mode);
    }
  }

  async function handleLatestDealsInteraction(interaction: DiscordInteraction) {
    if (!(await enforceCooldown(interaction, "latest reduceri"))) return;
    const endLog = startCommandLog(interaction, "latest reduceri");
    await safeDefer(interaction);

    const guildId = interaction.guild?.id;
    const guild = guildId ? await getGuildSettings(guildId) : null;
    const currency = guild?.currency || DEFAULT_CURRENCY;
    const mode: NotificationMode = guild?.notificationMode || "detailed";

    let deals = getDealsCacheData(currency);
    if (!deals) {
      const estMs = (await getSystemTimes()).reduceri || 10000;
      await safeEdit(interaction, `Se incarca: *Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
      const startTime = Date.now();
      try {
        deals = await fetchDeals({ currency });
        setDealsCache(currency, deals);
        await saveSystemTime("reduceri", smoothTime(estMs, Date.now() - startTime));
      } catch (err: unknown) {
        endLog("error", { errorMsg: errorMessage(err) });
        return safeEdit(interaction, formatUserError(err, "Nu am putut interoga magazinele.", "ERR_LATEST_DEALS"));
      }
    }
    const top = deals.filter(d => dealPassesFilters(d, guild)).slice(0, MAX_DEALS);
    if (!top.length) {
      endLog("no_data");
      return safeEdit(interaction, "Eroare: Nu am gasit oferte care sa corespunda setarilor serverului.");
    }
    const msg = await safeEdit(interaction, "OK: Oferte incarcate!");
    const generateEmbeds = async (page: number, totalP: number, currentMode: NotificationMode) => {
      const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
      const dealsToRender = currentMode === "compact"
        ? chunk
        : await Promise.all(chunk.map(async (deal) => {
            try { return await enrichDealData(deal, currency); }
            catch (err: unknown) {
              logger("WARN", "ENRICH", "Eroare enrich command handler", errorMessage(err));
              return deal;
            }
          }));
      return dealsToRender.map((d) => buildDealEmbed(d, currentMode, currency).setFooter({ text: `Pagina ${page + 1}/${totalP}` }));
    };
    endLog("ok", { resultCount: top.length });
    if (msg && interaction.user) {
      await handlePagination(msg, interaction.user.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode);
    }
  }

  async function handleLatestSingleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const gameText = interaction.options.getString("joc");
    if (!gameText) {
      return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "latest update"))) return;
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
        await saveSystemTime("single", smoothTime(estMs, Date.now() - startTime));
      }
      const guildId = interaction.guild?.id;
      const guild = guildId ? await getGuildSettings(guildId) : null;
      endLog("ok", { gameKey: game.key });
      return safeEdit(interaction, {
        content: `OK: Update **${game.name}**:`,
        embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")]
      });
    } catch (err: unknown) {
      endLog("error", { gameKey: game.key, errorMsg: errorMessage(err) });
      return safeEdit(interaction, formatUserError(err, "Nu am putut prelua acest update.", "ERR_LATEST_SINGLE"));
    }
  }

  async function handleLatestPriceInteraction(interaction: DiscordInteraction) {
    const gameName = interaction.options.getString("joc");
    if (!gameName) {
      return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "latest pret"))) return;
    const endLog = startCommandLog(interaction, "latest pret", { query: gameName });
    await safeDefer(interaction);

    const guildId = interaction.guild?.id;
    const guild = guildId ? await getGuildSettings(guildId) : null;
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
      // V9: trecem currency-ul pentru extractul de data — locale corect per guild.
      const offerEndDate = (gameData.price_overview?.discount_percent ?? 0) > 0
        ? await extractSteamOfferEndDate(bestMatch.id, currency)
        : null;
      endLog("ok", { appId: bestMatch.id });
      return safeEdit(interaction, {
        content: "OK: Am obtinut datele de pe Steam!",
        embeds: [buildSteamPriceEmbed(gameData, bestMatch.id, offerEndDate, currency)]
      });
    } catch (err: unknown) {
      endLog("error", { errorMsg: errorMessage(err) });
      logger("ERROR", "PRICE_SEARCH", "Eroare la cautare pret", errorMessage(err));
      return safeEdit(interaction, "Eroare: A aparut o eroare la cautarea pretului. `[ERR_PRICE_GENERAL]`");
    }
  }

  async function handleLatestInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const sub = interaction.options.getSubcommand();
    if (sub === "updates") return handleLatestUpdatesInteraction(interaction, games);
    if (sub === "reduceri") return handleLatestDealsInteraction(interaction);
    if (sub === "update") return handleLatestSingleInteraction(interaction, games);
    if (sub === "pret") return handleLatestPriceInteraction(interaction);
    // V11: defensive guard pentru sub necunoscut (pastrat din legacy). Daca un
    // nou sub e adaugat in slashCommandDefinitions.ts fara dispatch aici,
    // user-ul vedea "interaction failed" dupa 3s. Acum reply explicit.
    logger("WARN", "LATEST_COMMAND", `Subcomanda /latest necunoscuta: ${sub}`);
    return interaction.reply({
      content: `Eroare: Subcomanda \`/latest ${sub}\` nu este recunoscuta.`,
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
  }

  return {
    handleLatestInteraction,
    handleLatestUpdatesInteraction,
    handleLatestDealsInteraction,
    handleLatestSingleInteraction,
    handleLatestPriceInteraction
  };
}

function isLatestCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "latest";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installLatestInteractionHandler(ctx: LatestContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createLatestInteractionHandler(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isLatestCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    try {
      return await handlers.handleLatestInteraction(interaction, games);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "LATEST_INTERACTION", "Eroare in handler-ul /latest", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installLatestInteractionHandler, { createLatestInteractionHandler });

export = installLatestInteractionHandler;
