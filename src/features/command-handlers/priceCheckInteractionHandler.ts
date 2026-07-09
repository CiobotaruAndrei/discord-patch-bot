"use strict";

import type { DealInfo, GameConfig, GuildSettings, PriceValue } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { matchesCommand } from "../command-registry/commandMatch";
import {
  buildPriceCheckEmbed,
  findComparableDeals,
  titlesComparable,
  type SteamPriceData
} from "./priceCheckComparison";

const { errorMessage, errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

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
  return matchesCommand(interaction, { commandNames: ["price-check"] });
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
