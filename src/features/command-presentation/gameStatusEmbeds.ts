"use strict";

import type { GameConfig } from "../../types.js";
import type { ChainableEmbed, PresentationLogger } from "./presentationContracts.js";
import { errorMessage } from "../../shared/errors.js";

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

export interface SteamAppDetails {
  type?: string;
  price_overview?: SteamPriceOverview | null;
  is_free?: boolean;
  name?: string;
  header_image?: string;
}

export interface GameStatusEmbedsDeps {
  EmbedBuilder: new () => ChainableEmbed;
  COLORS: Record<string, number>;
  logger: PresentationLogger;
  httpReq(method: string, url: string, options?: Record<string, unknown>): Promise<HttpResponse>;
  DEFAULT_CURRENCY: string;
  formatPrice(value: unknown, currencyCode?: string): string;
}

export function createGameStatusEmbeds({ EmbedBuilder, COLORS, logger, httpReq, DEFAULT_CURRENCY, formatPrice }: GameStatusEmbedsDeps) {
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

  return { fetchGameStatus, buildSteamPriceEmbed };
}
