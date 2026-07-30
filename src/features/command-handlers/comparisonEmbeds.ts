"use strict";

import type { SteamReviewData } from "../../sources/sourceTypes.js";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis.js";
import type { ReviewTrendAnalysis } from "../game-info/reviewTrendAnalysis.js";
import {
  INFO_COLOR,
  WARNING_COLOR,
  hasCategory,
  platformList,
  type DiscordEmbed
} from "./gameInfoEmbedPrimitives.js";

export function buildReviewTrendEmbed(
  query: string,
  appId: string | number,
  details: SteamAppDetailsSummary,
  review: SteamReviewData,
  analysis: ReviewTrendAnalysis | null = null
): DiscordEmbed {
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
  const historical = analysis
    ? `${analysis.direction === "improving" ? "crestere" : analysis.direction === "declining" ? "scadere" : "stabil"}; ${analysis.qualityDelta >= 0 ? "+" : ""}${analysis.qualityDelta}% si ${analysis.newReviews} review-uri noi in ${analysis.windowDays ?? "?"} zile`
    : "Istoric insuficient: sunt necesare snapshot-uri valide din doua ferestre temporale.";
  const bombing = analysis?.possibleReviewBombing
    ? `${analysis.note} Incredere ${analysis.confidence}.`
    : analysis
      ? `Nu exista un semnal suficient de puternic pentru review-bombing. Incredere ${analysis.confidence}.`
      : "Semnalul de review-bombing nu poate fi evaluat inca.";
  return {
    title: `Review trend: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Stare curenta", value: `${quality}% pozitiv din ${review.totalReviews} review-uri (${label}).`, inline: false },
      { name: "Schimbare istorica", value: historical, inline: false },
      { name: "Semnal prudent", value: bombing, inline: false }
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
