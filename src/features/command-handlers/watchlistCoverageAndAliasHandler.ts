"use strict";

import type { GameConfig, GuildSettings, InteractionMessage } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { aliasOwner, gameAliasRecord, normalizeGameAlias } from "../guild-config/gameAliasService.js";
import { validateUserText } from "../command-security/userTextPolicy.js";
import { errorDetail } from "../../shared/errors.js";
import { applyGuildConfigUpdate, type GuildConfigWriteModelLike } from "../guild-config/guildConfigRepository.js";
import { sendPaginatedEdit } from "../command-presentation/textPagination.js";

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?(): boolean;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
  options: {
    getSubcommand(required?: boolean): string;
    getString(name: string, required?: boolean): string | null;
  };
}

interface CoverageAliasDeps {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<InteractionMessage | null>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  findGameAndSuggestion(query: string, games: GameConfig[]): { game: GameConfig | null; suggestion: GameConfig | null };
  GuildModel: GuildConfigWriteModelLike;
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
      dynamic[game.key] = [...(dynamic[game.key] || []), alias];
      await applyGuildConfigUpdate(deps.GuildModel, String(interaction.guild?.id), { gameAliases: dynamic });
      return deps.safeEdit(interaction, `OK: aliasul \`${alias}\` a fost adaugat pentru **${game.name}**.`);
    }
    const current = dynamic[game.key] || [];
    const next = current.filter(value => value !== alias);
    if (next.length === current.length) return deps.safeEdit(interaction, `Aliasul \`${alias}\` nu exista pentru **${game.name}**.`);
    if (next.length) dynamic[game.key] = next;
    else delete dynamic[game.key];
    await applyGuildConfigUpdate(deps.GuildModel, String(interaction.guild?.id), { gameAliases: dynamic });
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
