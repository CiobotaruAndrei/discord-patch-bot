"use strict";

import type {
  AutocompleteResponder,
  FocusedOptionReader,
  InteractionGuildRef,
  OptionalSubcommandOption,
  StringOption,
  SubcommandGroupOption
} from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import {
  createAutocompleteChoiceBuilders,
  MAX_AUTOCOMPLETE_INPUT_LEN,
  MAX_AUTOCOMPLETE_CHOICES,
  MAX_CHOICE_NAME_LEN,
  MAX_CHOICE_VALUE_LEN,
  type AutocompleteChoice,
  type GameConfig,
  type GuildSettingsLite,
  type Logger
} from "./autocompleteChoiceBuilders.js";

import { errorMessage, errorDetail } from "../../shared/errors.js";
import { buildAutocompleteChoices } from "../../native/fuzzy.js";
import { buildCommandHelpChoices } from "../command-help/commandHelpCatalog.js";
import { buildSettableAdminScopeChoices } from "../command-security/adminSettableScopeCatalog.js";
import { NOTIFICATION_TEMPLATE_SPECS } from "../notifications/templateCatalog.js";

type MaybePromise<T> = T | Promise<T>;
type FocusedOption = { name?: string; value?: unknown };
type DiscordInteraction = {
  commandName?: string;
  guild?: InteractionGuildRef | null;
  isAutocomplete?: () => boolean;
  isChatInputCommand?: () => boolean;
  options: FocusedOptionReader<FocusedOption> & OptionalSubcommandOption & SubcommandGroupOption & StringOption;
} & AutocompleteResponder<AutocompleteChoice>;
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type AutocompleteHandlerDeps = {
  logger: Logger;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
};

type AutocompleteContext = AutocompleteHandlerDeps;

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
  const builders = createAutocompleteChoiceBuilders({ logger, getGuildSettings });

  function acceptsGameOption(commandName: string | undefined, group: string | null, subcommand: string | null, optionName: string | undefined): boolean {
    if (optionName === "joc") return true;
    if (optionName !== "game") return false;
    if (commandName === "deal-score" || commandName === "player-count") return true;
    if (commandName === "sources" && subcommand === "refresh") return true;
    return (commandName === "start" || commandName === "stop") && subcommand === "player-count" && group === null;
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
        return interaction.respond(await builders.buildYouTubeChannelChoices(
          interaction,
          focused.value,
          false
        )).catch(() => null);
      }
      if (cmd === "template" && focused.name === "command") {
        return interaction.respond(buildCommandHelpChoices(focused.value)).catch(() => null);
      }
      if (cmd === "notification" && sub === "preview" && focused.name === "command") {
        const input = String(focused.value || "").toLocaleLowerCase("ro-RO");
        const choices = NOTIFICATION_TEMPLATE_SPECS
          .filter(spec => !input || spec.command.toLocaleLowerCase("ro-RO").includes(input))
          .map(spec => ({ name: spec.command, value: spec.command }))
          .slice(0, MAX_AUTOCOMPLETE_CHOICES);
        return interaction.respond(choices).catch(() => null);
      }
      if (cmd === "youtube" && group === "remove" && sub === "channel-route" && focused.name === "discord") {
        return interaction.respond(await builders.buildYouTubeRouteChoices(interaction, focused.value)).catch(() => null);
      }
      if (cmd === "youtube" && group === "remove" && sub === "title-filter" && focused.name === "word") {
        return interaction.respond(await builders.buildYouTubeTitleWordChoices(interaction, focused.value)).catch(() => null);
      }
      if (!acceptsGameOption(cmd, group, sub, focused.name)) {
        return interaction.respond([]).catch(() => null);
      }
      const input = String(focused.value || "").toLowerCase().trim().substring(0, MAX_AUTOCOMPLETE_INPUT_LEN);
      const useNameAsValue = (cmd === "dlc") || (cmd === "deal-score") || (cmd === "player-count") || (cmd === "latest" && sub === "pret");

      let pool = games;
      if ((cmd === "set" && group === "remove" && sub === "games") || (cmd === "watchlist" && sub === "remove") || (cmd === "remove" && sub === "watchlist")) {
        pool = await builders.buildSetGamesRemovePool(interaction, games);
      }
      if ((cmd === "price-alert" && sub === "remove") || (cmd === "remove" && sub === "price-alert")) {
        pool = await builders.buildPriceAlertRemovePool(interaction, games);
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

export default { createAutocompleteHandler, scoreGameAgainstInput, buildCommandHandler: buildAutocompleteCommandHandler };
