"use strict";

import type { SteamAppDetailsSummary } from "../../sources/sourceApis";
import {
  INFO_COLOR,
  extractInstallSize,
  requirementValue,
  type DiscordEmbed,
  type SafeCheerioLoad
} from "./gameInfoEmbedPrimitives";

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

export function buildGameSizeEmbed(query: string, appId: string | number, details: SteamAppDetailsSummary, load: SafeCheerioLoad): DiscordEmbed {
  const size = extractInstallSize(details, load);
  return {
    title: `Game size: ${details.name || query}`,
    url: `https://store.steampowered.com/app/${appId}`,
    color: INFO_COLOR,
    description: size ? `Dimensiune instalare detectata: **${size}**.` : "Steam nu expune o dimensiune clara in cerintele de sistem curente."
  };
}
