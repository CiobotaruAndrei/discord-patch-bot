"use strict";

import type {
  InteractionGuildRef,
  StringOption
} from "./discordInteractionPorts.js";
import { errorMessage } from "../../shared/errors.js";

export type GameConfig = { key: string; name: string; aliases?: string[] } & Record<string, unknown>;
export type AutocompleteChoice = { name: string; value: string };
export type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
export type GuildSettingsLite = {
  enabledGames?: string[];
  priceAlerts?: Array<{ gameKey?: string }>;
  youtubeChannels?: Array<{ channelId?: string; channelName?: string }>;
  youtubeChannelRoutes?: Array<{ channelId?: string; discordChannelIds?: string[] }>;
  youtubeTitleIncludeWords?: string[];
};

export type ChoiceBuilderInteraction = { guild?: InteractionGuildRef | null; options: StringOption };

export type AutocompleteChoiceBuilderDeps = {
  logger: Logger;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
};

export const MAX_AUTOCOMPLETE_INPUT_LEN = 100;
export const MAX_AUTOCOMPLETE_CHOICES = 25;
export const MAX_CHOICE_NAME_LEN = 100;
export const MAX_CHOICE_VALUE_LEN = 100;

export function createAutocompleteChoiceBuilders(deps: AutocompleteChoiceBuilderDeps) {
  const { logger, getGuildSettings } = deps;

  async function buildSetGamesRemovePool(interaction: ChoiceBuilderInteraction, games: GameConfig[]): Promise<GameConfig[]> {
    if (!interaction.guild) return games;
    try {
      const guild = await getGuildSettings(interaction.guild.id);
      const enabled = Array.isArray(guild?.enabledGames) ? guild!.enabledGames! : [];
      if (enabled.length === 0) return games;
      const enabledSet = new Set(enabled);
      const fromConfig = games.filter(g => enabledSet.has(g.key));
      const knownKeys = new Set(fromConfig.map(g => g.key));
      const stalePlaceholders: GameConfig[] = enabled
        .filter((key): key is string => typeof key === "string" && !knownKeys.has(key))
        .map(key => ({ key, name: `${key} (cheie stale)`, aliases: [] }));
      return [...fromConfig, ...stalePlaceholders];
    } catch (err: unknown) {
      logger("WARN", "AUTOCOMPLETE", "Nu am putut citi setarile guild-ului", errorMessage(err));
      return games;
    }
  }

  async function buildPriceAlertRemovePool(interaction: ChoiceBuilderInteraction, games: GameConfig[]): Promise<GameConfig[]> {
    if (!interaction.guild) return games;
    try {
      const guild = await getGuildSettings(interaction.guild.id);
      const alertKeys = Array.from(new Set(
        (Array.isArray(guild?.priceAlerts) ? guild.priceAlerts : [])
          .map(alert => String(alert.gameKey || ""))
          .filter(Boolean)
      ));
      if (!alertKeys.length) return [];
      const keys = new Set(alertKeys);
      const configured = games.filter(game => keys.has(game.key));
      const configuredKeys = new Set(configured.map(game => game.key));
      const stale = alertKeys
        .filter(key => !configuredKeys.has(key))
        .map(key => ({ key, name: `${key} (cheie indisponibila)`, aliases: [] }));
      return [...configured, ...stale];
    } catch (err: unknown) {
      logger("WARN", "AUTOCOMPLETE", "Nu am putut citi alertele de pret ale guild-ului", errorMessage(err));
      return games;
    }
  }

  async function buildYouTubeChannelChoices(
    interaction: ChoiceBuilderInteraction,
    inputValue: unknown,
    includeAll: boolean
  ): Promise<AutocompleteChoice[]> {
    if (!interaction.guild) return [];
    try {
      const guild = await getGuildSettings(interaction.guild.id);
      const input = String(inputValue ?? "").toLowerCase().trim().slice(0, MAX_AUTOCOMPLETE_INPUT_LEN);
      const choices = (guild?.youtubeChannels || [])
        .map(channel => ({
          name: String(channel.channelName || channel.channelId || "").slice(0, MAX_CHOICE_NAME_LEN),
          value: String(channel.channelId || "").slice(0, MAX_CHOICE_VALUE_LEN)
        }))
        .filter(choice => choice.value && (!input
          || choice.name.toLowerCase().includes(input)
          || choice.value.toLowerCase().includes(input)))
        .slice(0, includeAll ? MAX_AUTOCOMPLETE_CHOICES - 1 : MAX_AUTOCOMPLETE_CHOICES);
      return includeAll
        ? [{ name: "Toate canalele urmarite", value: "toate" }, ...choices]
        : choices;
    } catch (err: unknown) {
      logger("WARN", "AUTOCOMPLETE", "Nu am putut citi canalele YouTube ale guild-ului", errorMessage(err));
      return [];
    }
  }

  async function buildYouTubeRouteChoices(interaction: ChoiceBuilderInteraction, inputValue: unknown): Promise<AutocompleteChoice[]> {
    if (!interaction.guild) return [];
    try {
      const guild = await getGuildSettings(interaction.guild.id);
      const youtubeChannelId = interaction.options.getString("canal", false);
      const input = String(inputValue ?? "").toLowerCase().trim().slice(0, MAX_AUTOCOMPLETE_INPUT_LEN);
      const route = (guild?.youtubeChannelRoutes || []).find(item => item.channelId === youtubeChannelId);
      const routed = (route?.discordChannelIds || [])
        .map(channelId => ({ name: `#${channelId}`, value: channelId }))
        .filter(choice => !input || choice.name.includes(input) || choice.value.includes(input))
        .slice(0, MAX_AUTOCOMPLETE_CHOICES - 1);
      return [{ name: "Toate rutele speciale", value: "toate" }, ...routed];
    } catch (err: unknown) {
      logger("WARN", "AUTOCOMPLETE", "Nu am putut citi rutele YouTube ale guild-ului", errorMessage(err));
      return [];
    }
  }

  async function buildYouTubeTitleWordChoices(interaction: ChoiceBuilderInteraction, inputValue: unknown): Promise<AutocompleteChoice[]> {
    if (!interaction.guild) return [];
    try {
      const guild = await getGuildSettings(interaction.guild.id);
      const input = String(inputValue ?? "").toLowerCase().trim().slice(0, MAX_AUTOCOMPLETE_INPUT_LEN);
      return (guild?.youtubeTitleIncludeWords || [])
        .filter(word => !input || word.toLowerCase().includes(input))
        .map(word => ({ name: word.slice(0, MAX_CHOICE_NAME_LEN), value: word.slice(0, MAX_CHOICE_VALUE_LEN) }))
        .slice(0, MAX_AUTOCOMPLETE_CHOICES);
    } catch (err: unknown) {
      logger("WARN", "AUTOCOMPLETE", "Nu am putut citi filtrul de titlu YouTube", errorMessage(err));
      return [];
    }
  }

  return {
    buildSetGamesRemovePool,
    buildPriceAlertRemovePool,
    buildYouTubeChannelChoices,
    buildYouTubeRouteChoices,
    buildYouTubeTitleWordChoices
  };
}
