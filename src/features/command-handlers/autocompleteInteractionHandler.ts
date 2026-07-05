"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";

const { errorMessage, errorDetail } = require("../../shared/errors");
const { buildAutocompleteChoices } = require("../../native/fuzzy") as typeof import("../../native/fuzzy");
const { buildCommandHelpChoices } = require("../command-help/commandHelpCatalog") as typeof import("../command-help/commandHelpCatalog");
const { buildSettableAdminScopeChoices } = require("../command-security/adminSettableScopeCatalog") as typeof import("../command-security/adminSettableScopeCatalog");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string; aliases?: string[] } & Record<string, unknown>;
type AutocompleteChoice = { name: string; value: string };
type FocusedOption = { name?: string; value?: unknown };
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  isAutocomplete?: () => boolean;
  isChatInputCommand?: () => boolean;
  options: {
    getFocused(detailed: true): FocusedOption | null;
    getSubcommand(required: false): string | null;
    getSubcommandGroup(required: false): string | null;
    getString(name: string, required: false): string | null;
  };
  respond: (choices: AutocompleteChoice[]) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type GuildSettingsLite = {
  enabledGames?: string[];
  priceAlerts?: Array<{ gameKey?: string }>;
  youtubeChannels?: Array<{ channelId?: string; channelName?: string }>;
  youtubeChannelRoutes?: Array<{ channelId?: string; discordChannelIds?: string[] }>;
  youtubeTitleIncludeWords?: string[];
};

type AutocompleteHandlerDeps = {
  logger: Logger;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
};

type AutocompleteContext = AutocompleteHandlerDeps & {
  handleInteraction?: NextInteractionHandler;
};

const MAX_AUTOCOMPLETE_INPUT_LEN = 100;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LEN = 100;
const MAX_CHOICE_VALUE_LEN = 100;

const MIN_RELEVANT_SCORE = 20;
const SCORE_EXACT = 100;
const SCORE_PREFIX = 50;
const SCORE_CONTAINS = 20;

function scoreGameAgainstInput(game: GameConfig, input: string): number {
  const haystack = [
    String(game.name || "").toLowerCase(),
    String(game.key || "").toLowerCase(),
    ...(Array.isArray(game.aliases) ? game.aliases.map((a: unknown) => String(a).toLowerCase()) : [])
  ];
  let score = -1;
  for (const h of haystack) {
    if (!input) { score = Math.max(score, 0); continue; }
    if (h === input) score = Math.max(score, SCORE_EXACT);
    else if (h.startsWith(input)) score = Math.max(score, SCORE_PREFIX);
    else if (h.includes(input)) score = Math.max(score, SCORE_CONTAINS);
  }
  return score;
}

function createAutocompleteHandler(deps: AutocompleteHandlerDeps) {
  const { logger, getGuildSettings } = deps;

  function acceptsGameOption(commandName: string | undefined, group: string | null, subcommand: string | null, optionName: string | undefined): boolean {
    if (optionName === "joc") return true;
    if (optionName !== "game") return false;
    if (commandName === "deal-score" || commandName === "player-count") return true;
    return (commandName === "start" || commandName === "stop") && subcommand === "player-count" && group === null;
  }

  async function buildSetGamesRemovePool(interaction: DiscordInteraction, games: GameConfig[]): Promise<GameConfig[]> {
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

  async function buildPriceAlertRemovePool(interaction: DiscordInteraction, games: GameConfig[]): Promise<GameConfig[]> {
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
    interaction: DiscordInteraction,
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

  async function buildYouTubeRouteChoices(interaction: DiscordInteraction, inputValue: unknown): Promise<AutocompleteChoice[]> {
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

  async function buildYouTubeTitleWordChoices(interaction: DiscordInteraction, inputValue: unknown): Promise<AutocompleteChoice[]> {
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

  async function handleAutocomplete(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    try {
      const focused = interaction.options.getFocused(true);
      if (!focused) {
        return interaction.respond([]).catch(() => null);
      }
      const cmd = interaction.commandName;
      const sub = interaction.options.getSubcommand(false);
      const group = interaction.options.getSubcommandGroup(false);
      if (cmd === "help" && focused.name === "command") {
        return interaction.respond(buildCommandHelpChoices(focused.value)).catch(() => null);
      }
      if ((cmd === "snooze" || cmd === "unsnooze") && focused.name === "command") {
        return interaction.respond(buildCommandHelpChoices(focused.value, { excludeCommands: ["/snooze", "/unsnooze"] })).catch(() => null);
      }
      if ((cmd === "set" || cmd === "delete" || cmd === "admin-command-access") && focused.name === "command") {
        return interaction.respond(buildSettableAdminScopeChoices(focused.value)).catch(() => null);
      }
      if (cmd === "youtube" && focused.name === "canal") {
        return interaction.respond(await buildYouTubeChannelChoices(
          interaction,
          focused.value,
          group === "videos" && sub === "show"
        )).catch(() => null);
      }
      if (cmd === "youtube" && group === "remove" && sub === "channel-route" && focused.name === "discord") {
        return interaction.respond(await buildYouTubeRouteChoices(interaction, focused.value)).catch(() => null);
      }
      if (cmd === "youtube" && group === "remove" && sub === "title-filter" && focused.name === "word") {
        return interaction.respond(await buildYouTubeTitleWordChoices(interaction, focused.value)).catch(() => null);
      }
      if (!acceptsGameOption(cmd, group, sub, focused.name)) {
        return interaction.respond([]).catch(() => null);
      }
      const input = String(focused.value || "").toLowerCase().trim().substring(0, MAX_AUTOCOMPLETE_INPUT_LEN);
      const useNameAsValue = (cmd === "dlc") || (cmd === "deal-score") || (cmd === "player-count") || (cmd === "latest" && sub === "pret");

      let pool = games;
      if ((cmd === "set" && group === "remove" && sub === "games") || (cmd === "watchlist" && sub === "remove") || (cmd === "remove" && sub === "watchlist")) {
        pool = await buildSetGamesRemovePool(interaction, games);
      }
      if ((cmd === "price-alert" && sub === "remove") || (cmd === "remove" && sub === "price-alert")) {
        pool = await buildPriceAlertRemovePool(interaction, games);
      }

      const choices: AutocompleteChoice[] = buildAutocompleteChoices(
        pool,
        input,
        useNameAsValue,
        MIN_RELEVANT_SCORE,
        MAX_AUTOCOMPLETE_CHOICES,
        MAX_CHOICE_NAME_LEN,
        MAX_CHOICE_VALUE_LEN
      );
      await interaction.respond(choices).catch(() => null);
    } catch (err: unknown) {
      logger("WARN", "AUTOCOMPLETE", "Eroare in handler", errorMessage(err));
      interaction.respond([]).catch(() => null);
    }
  }

  return { handleAutocomplete, scoreGameAgainstInput };
}

function isAutocompleteInteraction(interaction: DiscordInteraction): boolean {
  return typeof interaction?.isAutocomplete === "function" && interaction.isAutocomplete() === true;
}

function buildAutocompleteCommandHandler(target: AutocompleteContext) {
  const handlers = createAutocompleteHandler({
    logger: target.logger,
    getGuildSettings: target.getGuildSettings
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isAutocompleteInteraction(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        return await handlers.handleAutocomplete(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "AUTOCOMPLETE", "Eroare top-level in handler-ul autocomplete", errorDetail(err));

        try { await di.respond([]); } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export = { createAutocompleteHandler, scoreGameAgainstInput, buildCommandHandler: buildAutocompleteCommandHandler };
