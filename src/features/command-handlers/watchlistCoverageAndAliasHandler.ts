"use strict";

import type {
  ChatInputInteraction,
  InteractionUserRef,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { InteractionMessage } from "../command-presentation/paginationTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { MAX_ALIASES_PER_GAME, MAX_TOTAL_GAME_ALIASES, aliasOwner, countTotalGameAliases, gameAliasRecord, normalizeGameAlias } from "../guild-config/gameAliasService.js";
import { validateUserText } from "../command-security/userTextPolicy.js";
import { errorDetail } from "../../shared/errors.js";
import { addGameAlias, removeGameAlias, type GameAliasGuildModelLike } from "../guild-config/gameAliasRepository.js";
import { sendPaginatedEdit } from "../command-presentation/textPagination.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type DiscordInteraction = ChatInputInteraction<SubcommandOption & StringOption> & { user?: InteractionUserRef | null };

interface CoverageAliasDeps {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<InteractionMessage | null>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  findGameAndSuggestion(query: string, games: GameConfig[]): { game: GameConfig | null; suggestion: GameConfig | null };
  GuildModel: GameAliasGuildModelLike;
  handlePagination<TItem, TEmbed>(message: InteractionMessage, userId: string, prefix: string, items: TItem[], pageSize: number, render: (page: number, totalPages: number) => TEmbed[]): Promise<void>;
  MessageFlags: { Ephemeral: number };
}

const COVERAGE_PAGE_SIZE = 8;

function yes(value: boolean): string {
  return value ? "✅" : "❌";
}

function capabilityLine(game: GameConfig): string {
  const updates = Boolean(game.type || game.url || game.listingUrl || game.listingUrls?.length);
  const discounts = Boolean(game.appId || game.type === "epic_games");
  const status = game.type === "epic_games" || ["roblox", "valorant", "lol", "minecraft"].includes(game.key);
  const players = Boolean(game.appId);
  const dlc = Boolean(game.appId);
  const sources = [game.type, ...(game.fallbacks || []).map(source => source.type)].filter(Boolean);
  return `**${game.name}** (\`${game.key}\`)\nUpdate ${yes(updates)} | Reduceri ${yes(discounts)} | Status ${yes(status)} | Player count ${yes(players)} | DLC ${yes(dlc)} | Steam appId ${yes(Boolean(game.appId))}\nSurse: ${sources.length ? sources.join(", ") : "indisponibile"}`;
}

function createCoverageAliasHandler(deps: CoverageAliasDeps) {
  async function coverage(interaction: DiscordInteraction, games: GameConfig[], settings: GuildSettings | null): Promise<unknown> {
    const enabled = Array.isArray(settings?.enabledGames) && settings.enabledGames.length ? settings.enabledGames : games.map(game => game.key);
    const byKey = new Map(games.map(game => [game.key, game]));
    const rows = enabled.map(key => byKey.get(key) || ({ key, name: `${key} (joc necunoscut)` } as GameConfig));
    const render = (page: number, totalPages: number) => [{
      title: "Watchlist coverage",
      color: 0x5865f2,
      description: rows.slice(page * COVERAGE_PAGE_SIZE, (page + 1) * COVERAGE_PAGE_SIZE).map(capabilityLine).join("\n\n"),
      footer: { text: `Pagina ${page + 1}/${totalPages}` }
    }];
    const message = await deps.safeEdit(interaction, { embeds: render(0, Math.max(1, Math.ceil(rows.length / COVERAGE_PAGE_SIZE))) });
    if (message && interaction.user?.id) await deps.handlePagination(message, interaction.user.id, "watchlist_coverage", rows, COVERAGE_PAGE_SIZE, render);
    return message;
  }

  async function aliasCommand(interaction: DiscordInteraction, games: GameConfig[], settings: GuildSettings | null): Promise<unknown> {
    const query = String(interaction.options.getString("joc", true) || "").trim();
    const { game, suggestion } = deps.findGameAndSuggestion(query, games);
    if (!game) return deps.safeEdit(interaction, suggestion ? `Nu am gasit jocul. Te refereai la **${suggestion.name}**?` : "Nu am gasit jocul.");
    const subcommand = interaction.options.getSubcommand(false);
    const dynamic = gameAliasRecord(settings?.gameAliases);
    if (subcommand === "list") {
      const aliases = dynamic[game.key] || [];
      if (!aliases.length) return deps.safeEdit(interaction, `**${game.name}** nu are aliasuri personalizate.`);
      const lines = [`Aliasuri pentru **${game.name}** (${aliases.length}):`, ...aliases.map(alias => `- \`${alias}\``)];
      return sendPaginatedEdit(interaction, payload => deps.safeEdit(interaction, payload), lines, { ephemeral: true });
    }
    let alias = "";
    try {
      alias = normalizeGameAlias(validateUserText("game-alias.alias", interaction.options.getString("alias", true) || ""));
    } catch {
      return deps.safeEdit(interaction, "Eroare: aliasul nu poate contine linkuri.");
    }
    if (alias.length < 2) return deps.safeEdit(interaction, "Eroare: aliasul trebuie sa aiba cel putin 2 caractere.");
    if (subcommand === "add") {
      const owner = aliasOwner(alias, games, dynamic);
      if (owner && owner !== game.key) return deps.safeEdit(interaction, `Eroare: aliasul este deja folosit de jocul \`${owner}\`.`);
      if (owner === game.key) return deps.safeEdit(interaction, `Aliasul \`${alias}\` exista deja pentru **${game.name}**.`);
      const currentForGame = dynamic[game.key] || [];
      if (currentForGame.length >= MAX_ALIASES_PER_GAME) {
        return deps.safeEdit(interaction, `Eroare: **${game.name}** are deja limita de ${MAX_ALIASES_PER_GAME} aliasuri. Sterge unul cu \`/game-alias remove\`.`);
      }
      if (countTotalGameAliases(dynamic) >= MAX_TOTAL_GAME_ALIASES) {
        return deps.safeEdit(interaction, `Eroare: serverul a atins limita totala de ${MAX_TOTAL_GAME_ALIASES} aliasuri de joc. Sterge cateva inainte de a adauga altele.`);
      }
      const { saved } = await addGameAlias(deps.GuildModel, String(interaction.guild?.id), game.key, alias);
      if (!saved) {
        return deps.safeEdit(interaction, `Eroare: nu am putut adauga aliasul (o comanda concurenta a ocupat ultimul loc din limita de ${MAX_ALIASES_PER_GAME}/joc sau ${MAX_TOTAL_GAME_ALIASES}/server). Reincearca.`);
      }
      return deps.safeEdit(interaction, `OK: aliasul \`${alias}\` a fost adaugat pentru **${game.name}** (${currentForGame.length + 1}/${MAX_ALIASES_PER_GAME}).`);
    }
    const { removed } = await removeGameAlias(deps.GuildModel, String(interaction.guild?.id), game.key, alias);
    if (!removed) return deps.safeEdit(interaction, `Aliasul \`${alias}\` nu exista pentru **${game.name}**.`);
    return deps.safeEdit(interaction, `OK: aliasul \`${alias}\` a fost sters pentru **${game.name}**.`);
  }

  async function handle(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await deps.safeDefer(interaction, true);
    const settings = await deps.getGuildSettings(guildId);
    return interaction.commandName === "watchlist"
      ? coverage(interaction, games, settings)
      : aliasCommand(interaction, games, settings);
  }

  return { handle };
}

function isCoverageOrAlias(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["watchlist"], subcommand: "coverage" })
    || matchesCommand(interaction, { commandNames: ["game-alias"] });
}

function buildCoverageAliasHandler(target: CoverageAliasDeps) {
  const suite = createCoverageAliasHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isCoverageOrAlias(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      try {
        return await suite.handle(interaction, games as GameConfig[]);
      } catch (error: unknown) {
        target.logger("ERROR", "COVERAGE_ALIAS", "Eroare la coverage sau alias", errorDetail(error));
        const payload = { content: "Eroare: operatia nu a putut fi finalizata.", flags: target.MessageFlags.Ephemeral };
        if ((interaction.deferred || interaction.replied) && interaction.followUp) return interaction.followUp(payload);
        return interaction.reply?.(payload);
      }
    }
  };
  return { suite, ...command };
}

export default { createCoverageAliasHandler, capabilityLine, buildCommandHandler: buildCoverageAliasHandler };

export const COVERAGE_ALIAS_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "findGameAndSuggestion",
  "getGuildSettings",
  "handlePagination",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type CoverageAliasKeyCheckDeps = Parameters<typeof buildCoverageAliasHandler>[0];
type CoverageAliasMissing = MissingDependencyKeys<CoverageAliasKeyCheckDeps, (typeof COVERAGE_ALIAS_HANDLER_KEYS)[number] & string>;
type CoverageAliasExtra = ExtraDependencyKeys<CoverageAliasKeyCheckDeps, (typeof COVERAGE_ALIAS_HANDLER_KEYS)[number] & string>;
const coverageAliasKeysComplete: ExactDependencyKeys<CoverageAliasMissing, CoverageAliasExtra> = true;
