"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";

const { errorMessage, errorDetail } = require("../../shared/errors");
const { buildAutocompleteChoices } = require("../../native/fuzzy") as typeof import("../../native/fuzzy");

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
  };
  respond: (choices: AutocompleteChoice[]) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type GuildSettingsLite = { enabledGames?: string[] };

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

  async function handleAutocomplete(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    try {
      const focused = interaction.options.getFocused(true);
      if (!focused || focused.name !== "joc") {
        return interaction.respond([]).catch(() => null);
      }
      const input = String(focused.value || "").toLowerCase().trim().substring(0, MAX_AUTOCOMPLETE_INPUT_LEN);
      const cmd = interaction.commandName;
      const sub = interaction.options.getSubcommand(false);
      const group = interaction.options.getSubcommandGroup(false);

      const useNameAsValue = (cmd === "dlc") || (cmd === "latest" && sub === "pret");

      let pool = games;
      if (cmd === "set" && group === "games" && sub === "remove") {
        pool = await buildSetGamesRemovePool(interaction, games);
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
  const command: CommandHandler = {
    canHandle: (interaction) => isAutocompleteInteraction(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction as DiscordInteraction;
      try {
        return await handlers.handleAutocomplete(di, games as GameConfig[]);
      } catch (err: unknown) {
        target.logger?.("ERROR", "AUTOCOMPLETE", "Eroare top-level in handler-ul autocomplete", errorDetail(err));

        try { await di.respond([]); } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

function installAutocompleteHandler(target: AutocompleteContext) {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildAutocompleteCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

export = Object.assign(installAutocompleteHandler, { createAutocompleteHandler, scoreGameAgainstInput, buildCommandHandler: buildAutocompleteCommandHandler });
