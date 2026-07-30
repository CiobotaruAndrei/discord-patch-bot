"use strict";

import type {
  AlwaysReplies,
  ChatInputInteraction,
  InteractionUserRef,
  StringOption
} from "./discordInteractionPorts.js";
import type { CheerioAPI } from "cheerio";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import type { InteractionMessage } from "../command-presentation/paginationTypes.js";
import type { NotificationMode } from "../notifications/notificationTypes.js";
import { dlcPageHasAgeGate, dlcPageLooksLikeStorePage, parseDlcRows } from "./dlcSteamPage.js";
import { matchesCommand } from "../command-registry/commandMatch.js";

import { errorMessage, errorDetail } from "../../shared/errors.js";

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = ChatInputInteraction<StringOption> & AlwaysReplies & { user?: InteractionUserRef };
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type DlcHandlerLogger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

type DlcCacheEntry = {
  dlcList: Array<{ name: string; price: string }>;
  title: string;
  appId: string | number;
  thumbUrl: string;
  totalExtracted: number;
};
type CacheEntry<T> = { data: T; expiresAt: number };
type DlcCache = Map<string, CacheEntry<DlcCacheEntry>>;

type SteamSearchItem = { id?: string | number; name?: string; type?: string };
type CurrencyConfig = { cc: string; symbol?: string };
type HttpRequestOptions = { headers?: Record<string, string>; timeout?: number };
type HttpResponse = { data: unknown };
type ChainableEmbed = {
  setColor(value: unknown): ChainableEmbed;
  setTitle(value: unknown): ChainableEmbed;
  setURL(value: unknown): ChainableEmbed;
  setThumbnail(value: unknown): ChainableEmbed;
  setDescription(value: unknown): ChainableEmbed;
  setFooter(value: unknown): ChainableEmbed;
};

type DlcHandlerDeps = {
  logger: DlcHandlerLogger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<InteractionMessage | null>;
  getGuildSettings: (guildId: string) => Promise<{ currency?: string } | null>;
  DEFAULT_CURRENCY: string;
  searchSteamGameByName: (query: string, currencyCode: string) => Promise<SteamSearchItem[]>;
  chooseBestSteamMatch: (items: SteamSearchItem[], query: string, options?: { forceGameOnly?: boolean }) => SteamSearchItem | null;
  fetchSteamPriceDetails: (appId: string | number, currencyCode: string) => Promise<{ header_image?: string } | null>;
  getCurrencyConfig: (code?: string) => CurrencyConfig;
  httpReq: (method: string, url: string, options?: HttpRequestOptions) => Promise<HttpResponse>;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  cache: { dlc: DlcCache };
  cacheGetLRU: <T>(map: Map<string, CacheEntry<T>>, key: string) => T | null;
  cacheSetLRU: <T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number, maxSize: number) => void;
  CACHE_TTL_MS: number;
  DLC_CACHE_MAX_SIZE: number;
  DLC_ITEMS_PER_PAGE: number;
  truncate: (str: unknown, maxLen: number) => string;
  EmbedBuilder: new () => ChainableEmbed;
  COLORS: { DLC: number } & Record<string, number>;
  handlePagination: <TItem, TEmbed>(
    msg: InteractionMessage,
    authorId: string,
    prefix: string,
    items: TItem[],
    itemsPerPage: number,
    generateEmbedsFn: (page: number, totalP: number, mode: NotificationMode) => Promise<TEmbed[]> | TEmbed[],
    defaultMode?: NotificationMode
  ) => Promise<void>;
  MessageFlags: { Ephemeral: number };
};

type DlcContext = DlcHandlerDeps;

function createDlcInteractionHandler(deps: DlcHandlerDeps) {
  const {
    logger, enforceCooldown, startCommandLog, safeDefer, safeEdit,
    getGuildSettings, DEFAULT_CURRENCY,
    searchSteamGameByName, chooseBestSteamMatch, fetchSteamPriceDetails,
    getCurrencyConfig, httpReq, safeCheerioLoad,
    cache, cacheGetLRU, cacheSetLRU, CACHE_TTL_MS, DLC_CACHE_MAX_SIZE,
    DLC_ITEMS_PER_PAGE, truncate, EmbedBuilder, COLORS, handlePagination,
    MessageFlags
  } = deps;

  async function handleDlcInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const gameName = interaction.options.getString("joc");
    if (!gameName) return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    if (!(await enforceCooldown(interaction, "dlc"))) return;
    const endLog = startCommandLog(interaction, "dlc", { query: gameName });
    await safeDefer(interaction);

    if (!interaction.guild) {
      return safeEdit(interaction, "Eroare: Comanda functioneaza doar pe servere.");
    }
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
        const title = String(bestMatch.name || "");
        let gameDetails: { header_image?: string } | null = null;
        try { gameDetails = await fetchSteamPriceDetails(bestMatch.id, currency); }
        catch (err: unknown) { logger("WARN", "DLC_SEARCH", `Nu am putut prelua header_image pentru ${bestMatch.id}`, errorMessage(err)); }
        const thumbUrl = gameDetails?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${bestMatch.id}/header.jpg`;
        const cc = getCurrencyConfig(currency).cc;
        const htmlRes = await httpReq("GET", `https://store.steampowered.com/app/${bestMatch.id}?cc=${cc}&l=english`, {
          headers: { Cookie: "birthtime=283993201; mature_content=1;" },
          timeout: 15000
        });
        const $ = safeCheerioLoad(htmlRes.data);
        if (dlcPageHasAgeGate($)) {
          endLog("age_gate", { appId: bestMatch.id });
          return safeEdit(interaction, `Eroare: Pagina de Steam pentru **${title}** necesita verificare de varsta, iar botul nu o poate accesa direct.`);
        }

        const dlcList = parseDlcRows($);
        if (!dlcList.length) {
          if (!dlcPageLooksLikeStorePage($)) {
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
      const generateEmbeds = (page: number, totalP: number) => {
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
      if (msg && interaction.user) {
        await handlePagination(msg, interaction.user.id, "dlc_cmd", dlcList, DLC_ITEMS_PER_PAGE, generateEmbeds, "detailed");
      }
    } catch (err: unknown) {
      endLog("error", { errorMsg: errorMessage(err) });
      logger("ERROR", "DLC_SEARCH", "Eroare la extragere DLC-uri", errorMessage(err));
      return safeEdit(interaction, "Eroare: A aparut o eroare la cautarea DLC-urilor. `[ERR_DLC_GENERAL]`");
    }
  }

  return { handleDlcInteraction };
}

function isDlcCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["dlc"] });
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildDlcCommandHandler(target: DlcContext) {
  const handlers = createDlcInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getGuildSettings: target.getGuildSettings,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    searchSteamGameByName: target.searchSteamGameByName,
    chooseBestSteamMatch: target.chooseBestSteamMatch,
    fetchSteamPriceDetails: target.fetchSteamPriceDetails,
    getCurrencyConfig: target.getCurrencyConfig,
    httpReq: target.httpReq,
    safeCheerioLoad: target.safeCheerioLoad,
    cache: target.cache,
    cacheGetLRU: target.cacheGetLRU,
    cacheSetLRU: target.cacheSetLRU,
    CACHE_TTL_MS: target.CACHE_TTL_MS,
    DLC_CACHE_MAX_SIZE: target.DLC_CACHE_MAX_SIZE,
    DLC_ITEMS_PER_PAGE: target.DLC_ITEMS_PER_PAGE,
    truncate: target.truncate,
    EmbedBuilder: target.EmbedBuilder,
    COLORS: target.COLORS,
    handlePagination: target.handlePagination,
    MessageFlags: target.MessageFlags
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isDlcCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleDlcInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "DLC_INTERACTION", "Eroare in handler-ul /dlc", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default { createDlcInteractionHandler, buildCommandHandler: buildDlcCommandHandler };
