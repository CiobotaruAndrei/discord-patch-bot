"use strict";

import type { SteamReviewData } from "../../types";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis";
import {
  INFO_COLOR,
  WARNING_COLOR,
  hasCategory,
  platformList,
  type DiscordEmbed
} from "./gameInfoEmbedPrimitives";

export function buildReviewTrendEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, review: SteamReviewData): DiscordEmbed {
  if (!review.success) {
    return {
      title: `Review trend: ${details.name || query}`,
      url: `https://store.steampowered.com/app/${appId}`,
      color: WARNING_COLOR,
      description: "Steam nu a returnat suficiente date de review pentru acest joc."
    };
  }
  const quality = review.qualityPercent;
  const label = quality >= 85 ? "foarte pozitiv" : quality >= 70 ? "pozitiv" : quality >= 50 ? "mixt" : "negativ";
  const trend = quality >= 70 ? "stabil pozitiv in snapshot-ul Steam curent" : quality >= 50 ? "zona mixta, merita verificat manual" : "semnal negativ puternic in snapshot-ul Steam curent";
  return {
    title: `Review trend: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Rezumat", value: `${quality}% pozitiv din ${review.totalReviews} review-uri`, inline: false },
      { name: "Interpretare", value: `${label}; ${trend}.`, inline: false },
      { name: "Nota", value: "Botul foloseste datele Steam curente. Trend istoric real cere stocare pe timp si va trebui adaugat separat.", inline: false }
    ]
  };
}

export function buildCrossplayEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary): DiscordEmbed {
  const crossplay = hasCategory(details, "Cross-Platform Multiplayer");
  const steamCloud = hasCategory(details, "Steam Cloud");
  return {
    title: `Crossplay: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Crossplay", value: crossplay ? "Detectat pe Steam ca Cross-Platform Multiplayer." : "Nedetectat in metadatele Steam curente.", inline: false },
      { name: "Cross-save/progression", value: steamCloud ? "Steam Cloud este detectat, dar asta nu confirma automat cross-save intre magazine/platforme externe." : "Nedetectat in metadatele Steam curente.", inline: false }
    ]
  };
}

export function buildPlatformsEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, externalStores: string[]): DiscordEmbed {
  const platforms = platformList(details);
  const stores = ["Steam", ...externalStores].filter((store, index, list) => list.indexOf(store) === index);
  return {
    title: `Platforms: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Platforme Steam", value: platforms.length ? platforms.join(", ") : "Nedetectat in metadatele Steam curente.", inline: false },
      { name: "Magazine detectate in sursele de reduceri", value: stores.join(", "), inline: false }
    ]
  };
}

export function buildCoopEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary): DiscordEmbed {
  const modes = [
    hasCategory(details, "Single-player") ? "Single-player" : "",
    hasCategory(details, "Online Co-op") ? "Online co-op" : "",
    hasCategory(details, "Shared/Split Screen Co-op") ? "Local/split-screen co-op" : "",
    hasCategory(details, "PvP") ? "PvP" : "",
    hasCategory(details, "MMO") ? "MMO" : ""
  ].filter(Boolean);
  return {
    title: `Co-op: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    description: modes.length ? modes.join(", ") : "Steam nu listeaza modurile de joc in sursa curenta."
  };
}
