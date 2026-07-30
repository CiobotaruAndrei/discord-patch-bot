"use strict";

import { decodeStatusPageResponse } from "../../sources/responseDecoders.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { ChainableEmbed, PresentationLogger } from "./presentationContracts.js";
import { errorMessage } from "../../shared/errors.js";

interface HttpResponse<T = unknown> {
  data: T;
}

export type GameServerState = "online" | "maintenance" | "degraded" | "unknown";

export interface GameServerStatus {
  state: GameServerState;
  label: string;
  detail: string;
  checkedAt: Date;
  statusUrl: string;
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
  function classifyIndicator(indicator: string): GameServerState {
    const normalized = indicator.toLowerCase();
    if (normalized === "none") return "online";
    if (normalized.includes("maintenance")) return "maintenance";
    if (normalized) return "degraded";
    return "unknown";
  }

  function labelFor(state: GameServerState): string {
    if (state === "online") return "Online";
    if (state === "maintenance") return "In mentenanta";
    if (state === "degraded") return "Degradat";
    return "Necunoscut";
  }

  async function loadStatusPage(apiUrl: string, statusUrl: string): Promise<GameServerStatus> {
    const checkedAt = new Date();
    try {
      const response = await httpReq("GET", apiUrl);
      const data = decodeStatusPageResponse(response.data);
      const state = classifyIndicator(String(data.status?.indicator || ""));
      return { state, label: labelFor(state), detail: String(data.status?.description || labelFor(state)), checkedAt, statusUrl };
    } catch (err: unknown) {
      logger("WARN", "STATUS", `Esec la verificarea ${apiUrl}`, errorMessage(err));
      return { state: "unknown", label: labelFor("unknown"), detail: "Sursa de status nu a putut fi verificata.", checkedAt, statusUrl };
    }
  }

  async function fetchGameStatusSummary(game: GameConfig): Promise<GameServerStatus> {
    if (game.type === "epic_games") {
      return loadStatusPage("https://status.epicgames.com/api/v2/status.json", "https://status.epicgames.com/");
    }
    if (game.key === "roblox") {
      return loadStatusPage("https://status.roblox.com/api/v2/status.json", "https://status.roblox.com/");
    }
    const statusUrl = game.key === "valorant" || game.key === "lol"
      ? "https://status.riotgames.com/"
      : game.key === "minecraft"
        ? "https://help.minecraft.net/hc/en-us/articles/360052646271-Minecraft-Server-Status"
        : String(game.url || game.baseUrl || "");
    return {
      state: "unknown",
      label: labelFor("unknown"),
      detail: "Jocul nu are o sursa live de status integrata.",
      checkedAt: new Date(),
      statusUrl
    };
  }

  async function fetchGameStatus(game: GameConfig): Promise<ChainableEmbed> {
    const status = await fetchGameStatusSummary(game);
    const color = status.state === "online" ? COLORS.POSITIVE : status.state === "unknown" ? COLORS.INFO : COLORS.ERROR;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`Status servere: ${game.name}`)
      .setDescription(`**Stare:** ${status.label}\n${status.detail}`)
      .setFooter({ text: `Ultima verificare: ${status.checkedAt.toISOString()}` });
    if (status.statusUrl.startsWith("http")) embed.addFields({ name: "Sursa", value: `[Verifica pagina oficiala](${status.statusUrl})` });
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

  return { fetchGameStatus, fetchGameStatusSummary, buildSteamPriceEmbed };
}
