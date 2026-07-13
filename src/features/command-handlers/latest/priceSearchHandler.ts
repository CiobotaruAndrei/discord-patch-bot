"use strict";

import { errorMessage } from "../../../shared/errors";

interface DiscordInteraction {
  guild?: { id: string } | null;
  options: { getString(name: string): string | null };
  reply: (payload: unknown) => Promise<unknown>;
}

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

interface GuildSettingsLite {
  currency?: string;
}

interface SteamPriceData {
  price_overview?: { initial: number; final: number; discount_percent: number } | null;
}

export interface PriceSearchHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown | null>;
  searchSteamGameByName: (query: string, currency: string) => Promise<Array<{ id?: string | number; name?: string }>>;
  chooseBestSteamMatch: (
    items: Array<{ id?: string | number; name?: string }>,
    query: string,
    options?: { forceGameOnly?: boolean }
  ) => { id?: string | number } | null;
  fetchSteamPriceDetails: (appId: string | number, currency: string) => Promise<SteamPriceData | null>;
  extractSteamOfferEndDate: (appId: string | number, currency: string) => Promise<string | null>;
  buildSteamPriceEmbed: (gameData: SteamPriceData, appId: string | number, offerEndDate: string | null, currency: string) => unknown;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
  DEFAULT_CURRENCY: string;
  MessageFlags: { Ephemeral: number };
}

export function createPriceSearchHandler(deps: PriceSearchHandlerDeps) {
  const {
    logger, enforceCooldown, startCommandLog, safeDefer, safeEdit,
    searchSteamGameByName, chooseBestSteamMatch, fetchSteamPriceDetails,
    extractSteamOfferEndDate, buildSteamPriceEmbed,
    getGuildSettings, DEFAULT_CURRENCY, MessageFlags
  } = deps;

  async function handlePriceSearch(interaction: DiscordInteraction) {
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

  return { handlePriceSearch };
}
