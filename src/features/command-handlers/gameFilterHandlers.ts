"use strict";

import { addWatchlistGame, applyGuildConfigUpdate, removeWatchlistGame } from "../guild-config/guildConfigRepository.js";
import type { DiscordReplyPayload, GameConfig, GuildSettings, MongoWriteOutcome } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { clampJoinedList } from "../command-presentation/discordListLimit.js";

import { errorDetail } from "../../shared/errors.js";
import { findGameByKey } from "../../config/gameCatalog.js";

type MaybePromise<T> = T | Promise<T>;

type InteractionPayload = DiscordReplyPayload;
type MongoWriteResult = MongoWriteOutcome;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type GameFilterSurface = "set-games" | "watchlist";

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getSubcommandGroup?(required: false): string | null;
    getString(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

type GameFilterInteractionDeps = {
  GuildModel: {
    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteResult>;
  };
  logger?: Logger;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string) => string;
  MessageFlags: { Ephemeral: number };
};

type GameFilterContext = GameFilterInteractionDeps;

function createGameFilterInteractionHandlers(deps: GameFilterInteractionDeps) {
  const { GuildModel, getGuildSettings, safeDefer, safeEdit, formatUserError, logger } = deps;

  async function handleGameFilterOperation(
    interaction: DiscordInteraction,
    games: GameConfig[],
    sub: string,
    guildId: string,
    surface: GameFilterSurface
  ) {
    if (sub === "show" || sub === "list") {
      const guild = await getGuildSettings(guildId);
      const enabled = Array.isArray(guild?.enabledGames) ? guild.enabledGames.map(String) : [];
      if (enabled.length === 0) {
        return safeEdit(interaction, "OK: Watchlist: **toate jocurile configurate sunt active**.");
      }
      const lines = enabled.map((key) => {
        const game = findGameByKey(games, key);
        return game ? `- **${game.name}** (\`${game.key}\`)` : `- \`${key}\` *(cheie necunoscuta in config)*`;
      });
      const header = `OK: Jocuri in watchlist (${enabled.length}):\n`;
      return safeEdit(interaction, `${header}${clampJoinedList(lines, 2000 - header.length)}`);
    }

    if (sub === "reset") {
      try {
        await applyGuildConfigUpdate(GuildModel, guildId, { enabledGames: [] });
        return safeEdit(interaction, "OK: Watchlist resetat. Toate jocurile sunt active.");
      } catch (err: unknown) {
        return safeEdit(interaction, formatUserError(err, "Eroare la resetare."));
      }
    }

    const gameKey = interaction.options.getString("joc");
    const game = findGameByKey(games, gameKey);

    try {
      if (sub === "add") {
        if (!game) {
          return safeEdit(interaction, `Eroare: Cheia \`${gameKey}\` nu exista in config. Foloseste \`/games\` pentru a vedea cheile valide.`);
        }
        await addWatchlistGame(GuildModel, guildId, game.key);
        return safeEdit(interaction, `OK: **${game.name}** adaugat in watchlist.`);
      }
      if (sub === "remove") {
        const result = await removeWatchlistGame(GuildModel, guildId, gameKey);
        const displayName = game ? game.name : String(gameKey);
        const note = game ? "" : " *(cheie nu mai exista in config — am curatat-o)*";
        if (result.modifiedCount === 0) {
          return safeEdit(interaction, `Info: **${displayName}** nu era in watchlist, nimic de scos.`);
        }
        return safeEdit(interaction, `OK: **${displayName}** scos din watchlist.${note}`);
      }
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la modificarea listei de jocuri."));
    }
    const label = surface === "watchlist" ? "/watchlist" : "/set games";
    const logContext = surface === "watchlist" ? "WATCHLIST" : "SET_GAMES";
    logger?.("WARN", logContext, `Subcomanda ${label} necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`${label} ${sub}\` nu este recunoscuta.`);
  }

  async function handleSetGames(interaction: DiscordInteraction, games: GameConfig[], sub: string, guildId: string) {
    return handleGameFilterOperation(interaction, games, sub, guildId, "set-games");
  }

  async function handleSetGamesInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const group = interaction.options.getSubcommandGroup?.(false);
    const sub = group === "add" || group === "remove" ? group : interaction.options.getSubcommand();
    await safeDefer(interaction, true);
    return handleSetGames(interaction, games, sub, guildId);
  }

  async function handleWatchlistInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const cmd = interaction.commandName;
    const rawSub = cmd === "add" || cmd === "remove" ? cmd : interaction.options.getSubcommand();
    const sub = rawSub === "watchlist-game" ? "watchlist" : rawSub;
    await safeDefer(interaction, true);
    return handleGameFilterOperation(interaction, games, sub, guildId, "watchlist");
  }

  return { handleGameFilterOperation, handleSetGames, handleSetGamesInteraction, handleWatchlistInteraction };
}

function isSetGamesCommand(interaction: DiscordInteraction) {
  if (!(interaction?.isChatInputCommand?.() === true && interaction.guild && interaction.commandName === "set")) return false;
  const group = interaction.options?.getSubcommandGroup?.(false);
  if (group === "games") return true;
  return (group === "add" || group === "remove") && interaction.options?.getSubcommand?.() === "games";
}

function isWatchlistCommand(interaction: DiscordInteraction) {
  if (!(interaction?.isChatInputCommand?.() === true && interaction.guild)) return false;
  if (interaction.commandName === "watchlist") return interaction.options?.getSubcommand?.() !== "coverage";
  const cmd = interaction.commandName;
  return (cmd === "add" || cmd === "remove") && ["watchlist", "watchlist-game"].includes(interaction.options?.getSubcommand?.() || "");
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildGameFilterCommandHandler(target: GameFilterContext) {
  const handlers = createGameFilterInteractionHandlers({
    GuildModel: target.GuildModel,
    logger: target.logger,
    getGuildSettings: target.getGuildSettings,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    formatUserError: target.formatUserError,
    MessageFlags: target.MessageFlags
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => Boolean(
      isSetGamesCommand(interaction as DiscordInteraction) || isWatchlistCommand(interaction as DiscordInteraction)
    ),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        if (isWatchlistCommand(di)) return await handlers.handleWatchlistInteraction(di, games);
        return await handlers.handleSetGamesInteraction(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "GAME_FILTER_INTERACTION", "Eroare in handler-ul de filtru jocuri", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") await di.followUp(payload);
          else if (typeof di.reply === "function") await di.reply(payload);
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default { createGameFilterInteractionHandlers, buildCommandHandler: buildGameFilterCommandHandler };
