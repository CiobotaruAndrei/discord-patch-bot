"use strict";

/**
 * V12: handler tipat pentru autocomplete pe slash commands.
 *
 * Extras din `legacyInteractionRouter.ts` ca parte din continuarea splitting-ului
 * review-ului extern (legacy router prea dependent de ctx). Autocomplete acopera
 * optiunile `joc` din `/dlc`, `/status`, `/latest update`, `/latest pret`,
 * `/set games add`, `/set games remove`.
 *
 * Deps tipate: logger + getGuildSettings (pentru filtrarea per-guild a pool-ului
 * la `/set games remove`). Niciun acces la `ctx` global in interiorul handler-ului.
 *
 * Acest installer NU wrapeaza dispatcher-ul global de handleInteraction — el
 * verifica explicit `isAutocomplete()` si delegheaza in jos pentru orice
 * altceva, simetric cu cele 8 installer-e de comenzi.
 */

const { errorMessage, errorDetail } = require("../../shared/errors");

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

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;
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

// V11: scorul minim necesar daca user-ul a tastat ceva (filtrare candidati slabi).
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
    // V11: explicit guard. Autocomplete fire-uieste doar din guild context in
    // practica, dar payload-uri malformate sau o testare manuala via API ar
    // putea trimite autocomplete fara guild — inainte aruncam pe `.id`.
    if (!interaction.guild) return games;
    try {
      const guild = await getGuildSettings(interaction.guild.id);
      const enabled = Array.isArray(guild?.enabledGames) ? guild!.enabledGames! : [];
      if (enabled.length === 0) return games;
      const enabledSet = new Set(enabled);
      const fromConfig = games.filter(g => enabledSet.has(g.key));
      // V11: include si cheile STALE (in enabledGames dar nu mai exista in
      // config) ca sa poata fi sterse. Vechea forma le ascundea complet din
      // autocomplete iar comanda `remove` le respingea ca "cheie nu exista in
      // config" — operatorul ramanea blocat cu intrari stale.
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

      // Pentru Steam search (dlc, latest pret) returnam numele complet.
      const useNameAsValue = (cmd === "dlc") || (cmd === "latest" && sub === "pret");

      // Pentru /set games remove restrangem pool-ul la jocurile active (+stale).
      let pool = games;
      if (cmd === "set" && group === "games" && sub === "remove") {
        pool = await buildSetGamesRemovePool(interaction, games);
      }

      const candidates: Array<{ game: GameConfig; score: number }> = [];
      for (const game of pool) {
        const score = scoreGameAgainstInput(game, input);
        // Filtram scorurile prea slabe doar daca user-ul a tastat ceva.
        if (input && score < MIN_RELEVANT_SCORE) continue;
        candidates.push({ game, score });
      }
      // V11: tiebreaker alfabetic dupa nume, ca ordinea sugestiilor sa nu mai
      // sara aleator intre apasarile de tasta cand multi candidati au acelasi scor.
      candidates.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return String(a.game.name || "").localeCompare(String(b.game.name || ""));
      });

      const choices: AutocompleteChoice[] = candidates.slice(0, MAX_AUTOCOMPLETE_CHOICES).map(c => ({
        name: `${c.game.name} (${c.game.key})`.substring(0, MAX_CHOICE_NAME_LEN),
        value: (useNameAsValue ? c.game.name : c.game.key).substring(0, MAX_CHOICE_VALUE_LEN)
      }));
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

function installAutocompleteHandler(ctx: AutocompleteContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createAutocompleteHandler(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isAutocompleteInteraction(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    try {
      return await handlers.handleAutocomplete(interaction, games);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "AUTOCOMPLETE", "Eroare top-level in handler-ul autocomplete", errorDetail(err));
      // Daca am ajuns aici, nici inner-ul nu a putut raspunde — incercam un
      // respond gol ca Discord sa nu mai astepte 3 secunde inutil.
      try { await interaction.respond([]); } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installAutocompleteHandler, { createAutocompleteHandler, scoreGameAgainstInput });

export = installAutocompleteHandler;
