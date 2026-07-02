"use strict";

import type { YouTubeFilters } from "../../../types";
import type { DiscordInteraction, YouTubeInteractionDeps } from "./youtubeCommandTypes";
import { YOUTUBE_TITLE_WORD_LIMIT, normalizeYouTubeTitleWord } from "../../youtube/youtubeDeliveryPolicy";
import {
  addYouTubeTitleWord,
  clearYouTubeTitleWords,
  removeYouTubeTitleWord,
  setYouTubeFilterFlag,
  setYouTubeMinDurationSeconds
} from "../../youtube/youtubeGuildConfigRepository";
import { clampJoinedList } from "../../command-presentation/discordListLimit";
import { defaultFilters, formatFilters, onOff } from "./youtubePresentation";

const { errorDetail } = require("../../../shared/errors") as typeof import("../../../shared/errors");

export function createYouTubeFilterCommands(deps: YouTubeInteractionDeps) {
  const { GuildModel, getGuildSettings, invalidateGuildCache, safeEdit } = deps;

  async function filter(interaction: DiscordInteraction, guildId: string, subcommand: string): Promise<unknown> {
    const fieldBySubcommand: Record<string, keyof YouTubeFilters> = {
      shorts: "excludeShorts",
      lives: "excludeLives",
      premieres: "excludePremieres"
    };
    if (subcommand === "status") {
      return safeEdit(interaction, formatFilters(defaultFilters(await getGuildSettings(guildId))));
    }
    if (subcommand === "min-duration") {
      const seconds = interaction.options.getInteger("seconds", true);
      if (seconds === null || seconds < 0 || seconds > 86400) {
        return safeEdit(interaction, "Eroare: durata minima trebuie sa fie intre 0 si 86400 secunde.");
      }
      await setYouTubeMinDurationSeconds(GuildModel, guildId, seconds);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: durata minima YouTube este ${seconds}s.`);
    }
    const field = fieldBySubcommand[subcommand];
    const state = interaction.options.getString("state", true);
    if (!field || (state !== "on" && state !== "off")) {
      return safeEdit(interaction, "Eroare: filtrul sau starea on/off nu este valida.");
    }
    const enabled = state === "on";
    await setYouTubeFilterFlag(GuildModel, guildId, field, enabled);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: filtrul YouTube ${subcommand} este ${onOff(enabled)}.`);
  }

  async function titleFilter(
    interaction: DiscordInteraction,
    guildId: string,
    subcommand: string
  ): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    const words = settings?.youtubeTitleIncludeWords || [];
    if (subcommand === "list") {
      const header = "Filtrul inclusiv accepta titluri care contin cel putin una dintre valorile:\n";
      return safeEdit(interaction, words.length
        ? `${header}${clampJoinedList(words.map(word => `- \`${word}\``), 2000 - header.length)}`
        : "Filtrul inclusiv de titlu este gol. Toate titlurile trec acest filtru.");
    }
    if (subcommand === "clear") {
      await clearYouTubeTitleWords(GuildModel, guildId);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: filtrul inclusiv de titlu a fost golit.");
    }
    const rawWord = interaction.options.getString("word", true);
    if (!rawWord) return safeEdit(interaction, "Eroare: introdu o valoare pentru filtrul de titlu.");
    try {
      const word = normalizeYouTubeTitleWord(rawWord);
      if (subcommand === "add") {
        if (words.length >= YOUTUBE_TITLE_WORD_LIMIT && !words.includes(word)) {
          return safeEdit(interaction, `Eroare: filtrul poate avea cel mult ${YOUTUBE_TITLE_WORD_LIMIT} valori.`);
        }
        const outcome = await addYouTubeTitleWord(GuildModel, guildId, word);
        invalidateGuildCache(guildId);
        if (!outcome.saved) {
          return safeEdit(interaction, `Eroare: filtrul poate avea cel mult ${YOUTUBE_TITLE_WORD_LIMIT} valori (o comanda concurenta a ocupat ultimul loc).`);
        }
        return safeEdit(interaction, `OK: \`${word}\` a fost adaugat in filtrul inclusiv de titlu.`);
      }
      await removeYouTubeTitleWord(GuildModel, guildId, word);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: \`${word}\` a fost eliminat din filtrul inclusiv de titlu.`);
    } catch (error) {
      return safeEdit(interaction, `Eroare: ${errorDetail(error)}`);
    }
  }

  return { filter, titleFilter };
}
