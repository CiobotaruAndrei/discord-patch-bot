"use strict";

import type { SteamAppDetailsSummary, SteamLatestUpdateSizeSummary } from "../../sources/sourceApis.js";
import {
  INFO_COLOR,
  extractInstallSize,
  requirementValue,
  type DiscordEmbed,
  type SafeCheerioLoad
} from "./gameInfoEmbedPrimitives.js";

export function buildSystemRequirementsEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: SafeCheerioLoad): DiscordEmbed {
  const minimum = requirementValue(details, "minimum", load);
  const recommended = requirementValue(details, "recommended", load);
  return {
    title: `System requirements: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Minim", value: minimum.slice(0, 1000) || "Nedisponibil in metadatele Steam curente.", inline: false },
      { name: "Recomandat", value: recommended.slice(0, 1000) || "Nedisponibil in metadatele Steam curente.", inline: false }
    ]
  };
}

export function buildGameSizeEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: SafeCheerioLoad, latestUpdate?: SteamLatestUpdateSizeSummary): DiscordEmbed {
  const installSize = extractInstallSize(details, load);
  return {
    title: `Game size: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    fields: [
      { name: "Instalare", value: installSize ? `Aproximativ **${installSize}**` : "indisponibil", inline: true },
      { name: "Ultimul update", value: latestUpdate?.size ? `Aproximativ **${latestUpdate.size}**${latestUpdate.title ? `\n${latestUpdate.title}` : ""}` : "indisponibil", inline: true }
    ],
    footer: { text: "Dimensiunea update-ului este afisata numai cand sursa Steam o publica explicit." }
  };
}
