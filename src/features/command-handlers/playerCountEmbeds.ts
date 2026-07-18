"use strict";

import type { GameConfig } from "../../types.js";
import type { SteamAppDetailsSummary, SteamCurrentPlayersSummary } from "../../sources/sourceApis.js";
import {
  INFO_COLOR,
  RESULT_LIMIT_DEFAULT,
  WARNING_COLOR,
  type DiscordEmbed
} from "./gameInfoEmbedPrimitives.js";

export function formatPlayerCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

export function buildPlayerCountEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, players: SteamCurrentPlayersSummary): DiscordEmbed {
  return {
    title: `Player count: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: players.success ? INFO_COLOR : WARNING_COLOR,
    description: players.success
      ? `Jucatori activi pe Steam acum: **${formatPlayerCount(players.playerCount)}**.`
      : "Steam nu a returnat un numar valid de jucatori activi pentru acest joc."
  };
}

export interface PlayerCountTrendSummary {
  peak24h: number | null;
  direction: "creștere" | "scădere" | "stabil" | null;
  samples: number;
}

export function buildPlayerCountEmbedWithTrend(query: string, appId: string | number, details: SteamAppDetailsSummary, players: SteamCurrentPlayersSummary, trend: PlayerCountTrendSummary | null): DiscordEmbed {
  const base = buildPlayerCountEmbed(query, appId, details, players);
  if (!trend) return { ...base, fields: [{ name: "Istoric 24h", value: "Indisponibil: nu există suficiente snapshot-uri.", inline: false }] };
  return {
    ...base,
    fields: [
      { name: "Peak ultimele 24h", value: trend.peak24h === null ? "Indisponibil" : formatPlayerCount(trend.peak24h), inline: true },
      { name: "Direcție", value: trend.direction ?? "Indisponibil", inline: true },
      { name: "Snapshot-uri", value: String(trend.samples), inline: true }
    ]
  };
}

export function buildTopActiveGamesEmbed(items: Array<{ game: GameConfig; players: SteamCurrentPlayersSummary }>, limit = RESULT_LIMIT_DEFAULT, notChecked = 0): DiscordEmbed {
  const successful = items
    .filter(item => item.players.success)
    .sort((left, right) => right.players.playerCount - left.players.playerCount)
    .slice(0, limit);
  const missing = items.length - items.filter(item => item.players.success).length;
  if (!successful.length) {
    return {
      title: "Top active games",
      color: WARNING_COLOR,
      description: "Steam nu a returnat date valide de player count pentru jocurile verificate."
    };
  }
  const base = "Top calculat din toate jocurile cunoscute de bot care au Steam appId.";
  const missingNote = missing > 0 ? ` ${missing} joc(uri) nu au putut fi verificate pe Steam acum si au fost omise.` : "";
  const subsetNote = notChecked > 0 ? ` Topul e calculat din primele ${items.length} jocuri verificate; alte ${notChecked} nu au fost verificate in acest raspuns.` : "";
  return {
    title: "Top active games",
    color: INFO_COLOR,
    description: `${base}${missingNote}${subsetNote}`,
    fields: successful.map((item, index) => ({
      name: `${index + 1}. ${item.game.name}`,
      value: `${formatPlayerCount(item.players.playerCount)} jucatori activi pe Steam`,
      inline: false
    }))
  };
}

export function selectTopActiveGames(games: GameConfig[]): GameConfig[] {
  return games.filter(game => Boolean(game.appId));
}
