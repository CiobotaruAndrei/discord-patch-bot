"use strict";

import type { DealInfo, GameConfig, GuildSettings, PriceValue } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";

const { errorMessage, errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

interface SteamPriceData {
  name?: string;
  is_free?: boolean;
  price_overview?: { initial: number; final: number; discount_percent: number } | null;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getString(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface PriceCheckDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  searchSteamGameByName(query: string, currency: string): Promise<Array<{ id?: string | number; name?: string }>>;
  chooseBestSteamMatch(
    items: Array<{ id?: string | number; name?: string }>,
    query: string,
    options?: { forceGameOnly?: boolean }
  ): { id?: string | number; name?: string } | null;
  fetchSteamPriceDetails(appId: string | number, currency: string): Promise<SteamPriceData | null>;
  getDealsCacheData(currency: string): DealInfo[] | null;
  setDealsCache(currency: string, deals: DealInfo[]): void;
  fetchDeals(opts: { currency: string }): Promise<DealInfo[]>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  formatPrice(value: PriceValue, currencyCode?: string | null): string;
  DEFAULT_CURRENCY: string;
  MessageFlags: { Ephemeral: number };
}

type PriceCheckContext = PriceCheckDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numericPrice(value: PriceValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function steamPriceLine(data: SteamPriceData, currency: string, formatPrice: PriceCheckDeps["formatPrice"]): string {
  if (data.is_free) return "Steam [verde]: GRATUIT";
  const overview = data.price_overview;
  if (!overview) return "Steam [verde]: pret indisponibil";
  const current = overview.final / 100;
  const old = overview.initial / 100;
  const discount = overview.discount_percent;
  if (discount > 0 && old > current) {
    return `Steam [verde]: ${formatPrice(current, currency)} (reducere ${discount}%, pret vechi ${formatPrice(old, currency)})`;
  }
  return `Steam [verde]: ${formatPrice(current, currency)}`;
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value).split(" ").filter(token => token.length >= 2);
}

function titlesComparable(target: string, title: string): boolean {
  const normalizedTarget = normalizeTitle(target);
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTarget || !normalizedTitle) return false;
  if (normalizedTarget === normalizedTitle) return true;
  const targetTokens = new Set(titleTokens(target));
  const dealTokens = new Set(titleTokens(title));
  if (targetTokens.size === 0 || dealTokens.size === 0) return false;
  let shared = 0;
  for (const token of targetTokens) if (dealTokens.has(token)) shared++;
  const coverage = shared / targetTokens.size;
  const union = targetTokens.size + dealTokens.size - shared;
  const jaccard = union > 0 ? shared / union : 0;
  return coverage === 1 || jaccard >= 0.6;
}

function findComparableDeals(deals: DealInfo[], query: string, steamName: string, appId: string | number): DealInfo[] {
  const appIdStr = String(appId ?? "").trim();
  const targets = [query, steamName].map(value => String(value || "")).filter(Boolean);
  return deals.filter(deal => {
    const store = normalizeTitle(String(deal.store || ""));
    if (store.includes("steam")) return false;
    if (appIdStr && String(deal.appId ?? "").trim() === appIdStr) return true;
    if (!normalizeTitle(String(deal.title || ""))) return false;
    return targets.some(target => titlesComparable(target, String(deal.title || "")));
  }).slice(0, 5);
}

function buildPriceCheckEmbed(
  query: string,
  appId: string | number,
  steamData: SteamPriceData,
  externalDeals: DealInfo[],
  currency: string,
  formatPrice: PriceCheckDeps["formatPrice"],
  externalError: string | null
): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    {
      name: "Steam",
      value: steamPriceLine(steamData, currency, formatPrice),
      inline: false
    }
  ];
  if (externalDeals.length) {
    for (const deal of externalDeals) {
      const price = numericPrice(deal.salePrice);
      const priceText = price === null ? String(deal.salePrice ?? "pret indisponibil") : formatPrice(price, String(deal.currency || currency));
      const store = String(deal.store || "magazin extern");
      const link = String(deal.link || deal.url || "");
      fields.push({
        name: store,
        value: link ? `${priceText} - ${link}` : priceText,
        inline: false
      });
    }
  } else {
    fields.push({
      name: "Alte surse",
      value: externalError || "Nu am gasit o oferta comparabila in sursele de reduceri active ale botului.",
      inline: false
    });
  }
  return {
    title: `Price check: ${steamData.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: 0x2ecc71,
    description: "Pretul Steam este afisat pe embed-ul verde; celelalte randuri sunt comparatii din sursele externe deja folosite de bot.",
    fields
  };
}

function createPriceCheckInteractionHandler(deps: PriceCheckDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit, searchSteamGameByName,
    chooseBestSteamMatch, fetchSteamPriceDetails, getDealsCacheData, setDealsCache,
    fetchDeals, getGuildSettings, formatPrice, DEFAULT_CURRENCY
  } = deps;

  async function loadComparableDeals(currency: string): Promise<{ deals: DealInfo[]; error: string | null }> {
    const cached = getDealsCacheData(currency);
    if (cached) return { deals: cached, error: null };
    try {
      const deals = await fetchDeals({ currency });
      setDealsCache(currency, deals);
      return { deals, error: null };
    } catch (err: unknown) {
      return { deals: [], error: `Nu am putut incarca sursele externe acum: ${errorMessage(err)}` };
    }
  }

  async function handlePriceCheck(interaction: DiscordInteraction): Promise<unknown> {
    const query = String(interaction.options.getString("joc", true) || "").trim();
    if (!query) return interaction.reply?.({ content: "Eroare: trebuie sa specifici jocul.", flags: deps.MessageFlags.Ephemeral });
    if (!(await enforceCooldown(interaction, "price-check"))) return undefined;
    const endLog = startCommandLog(interaction, "price-check", { query });
    await safeDefer(interaction);
    const guild = interaction.guild?.id ? await getGuildSettings(interaction.guild.id) : null;
    const currency = String(guild?.currency || DEFAULT_CURRENCY);
    await safeEdit(interaction, `Se incarca: compar pretul pentru **${query}**...`);
    try {
      const items = await searchSteamGameByName(query, currency);
      const best = chooseBestSteamMatch(items, query, { forceGameOnly: true });
      if (!best?.id) {
        endLog("not_found");
        return safeEdit(interaction, `Eroare: nu am gasit jocul \`${query}\` pe Steam.`);
      }
      const steamData = await fetchSteamPriceDetails(best.id, currency);
      if (!steamData) {
        endLog("no_details", { appId: best.id });
        return safeEdit(interaction, "Eroare: am gasit jocul pe Steam, dar pretul nu este disponibil.");
      }
      const comparable = await loadComparableDeals(currency);
      const externalDeals = findComparableDeals(comparable.deals, query, steamData.name || best.name || query, best.id ?? "");
      endLog("ok", { appId: best.id, externalDeals: externalDeals.length });
      return safeEdit(interaction, {
        content: "OK: comparatia de pret este gata.",
        embeds: [buildPriceCheckEmbed(query, best.id, steamData, externalDeals, currency, formatPrice, comparable.error)]
      });
    } catch (err: unknown) {
      endLog("error", { errorMsg: errorMessage(err) });
      deps.logger("WARN", "PRICE_CHECK", "Eroare la /price-check", errorDetail(err));
      return safeEdit(interaction, "Eroare: nu am putut face comparatia de pret acum.");
    }
  }

  return { handlePriceCheck };
}

function isPriceCheckCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "price-check";
}

function buildPriceCheckCommandHandler(target: PriceCheckContext) {
  const handlers = createPriceCheckInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isPriceCheckCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handlePriceCheck(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "PRICE_CHECK", "Eroare neasteptata in /price-check", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa comanda /price-check.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export = {
  createPriceCheckInteractionHandler,
  buildPriceCheckEmbed,
  buildCommandHandler: buildPriceCheckCommandHandler,
  findComparableDeals,
  titlesComparable
};
