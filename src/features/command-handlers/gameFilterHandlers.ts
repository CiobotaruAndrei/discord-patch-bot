"use strict";

import type { GameConfig, GuildSettings } from "../../types";

const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;

type InteractionPayload = string | Record<string, unknown>;
type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

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
  invalidateGuildCache: (guildId: string) => void;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string) => string;
  MessageFlags: { Ephemeral: number };
};

type GameFilterContext = GameFilterInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
};

function createGameFilterInteractionHandlers(deps: GameFilterInteractionDeps) {
  const { GuildModel, getGuildSettings, invalidateGuildCache, safeDefer, safeEdit, formatUserError, logger } = deps;

  async function handleSetGames(interaction: DiscordInteraction, games: GameConfig[], sub: string, guildId: string) {
    if (sub === "list") {
      const guild = await getGuildSettings(guildId);
      const enabled = Array.isArray(guild?.enabledGames) ? guild.enabledGames.map(String) : [];
      if (enabled.length === 0) {
        return safeEdit(interaction, "OK: Filtru per-joc: **dezactivat** (toate jocurile configurate sunt active).");
      }
      const lines = enabled.map((key) => {
        const game = games.find((candidate) => candidate.key === key);
        return game ? `- **${game.name}** (\`${game.key}\`)` : `- \`${key}\` *(cheie necunoscuta in config)*`;
      });
      return safeEdit(interaction, `OK: Jocuri active explicit (${enabled.length}):\n` + lines.join("\n"));
    }

    if (sub === "reset") {
      try {
        await GuildModel.updateOne({ _id: guildId }, { $set: { enabledGames: [] } }, { upsert: true });
        invalidateGuildCache(guildId);
        return safeEdit(interaction, "OK: Filtru per-joc resetat. Toate jocurile sunt active.");
      } catch (err: unknown) {
        return safeEdit(interaction, formatUserError(err, "Eroare la resetare."));
      }
    }

    const gameKey = interaction.options.getString("joc");
    const game = games.find(candidate => candidate.key === gameKey);

    try {
      if (sub === "add") {
        if (!game) {
          return safeEdit(interaction, `Eroare: Cheia \`${gameKey}\` nu exista in config. Foloseste \`/games\` pentru a vedea cheile valide.`);
        }
        await GuildModel.updateOne(
          { _id: guildId },
          { $addToSet: { enabledGames: gameKey } },
          { upsert: true }
        );
        invalidateGuildCache(guildId);
        return safeEdit(interaction, `OK: **${game.name}** adaugat la lista activa.`);
      }
      if (sub === "remove") {
        const result = await GuildModel.updateOne(
          { _id: guildId },
          { $pull: { enabledGames: gameKey } }
        );
        invalidateGuildCache(guildId);
        const displayName = game ? game.name : String(gameKey);
        const note = game ? "" : " *(cheie nu mai exista in config — am curatat-o)*";
        if (result.modifiedCount === 0) {
          return safeEdit(interaction, `Info: **${displayName}** nu era in lista activa, nimic de scos.`);
        }
        return safeEdit(interaction, `OK: **${displayName}** scos din lista activa.${note}`);
      }
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la modificarea listei de jocuri."));
    }
    logger?.("WARN", "SET_GAMES", `Subcomanda /set games necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`/set games ${sub}\` nu este recunoscuta.`);
  }

  async function handleSetGamesInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction);
    return handleSetGames(interaction, games, sub, guildId);
  }

  return { handleSetGames, handleSetGamesInteraction };
}

function isSetGamesCommand(interaction: DiscordInteraction) {
  return interaction?.isChatInputCommand?.() === true
    && interaction.guild
    && interaction.commandName === "set"
    && interaction.options?.getSubcommandGroup?.(false) === "games";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installGameFilterInteractions(ctx: GameFilterContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createGameFilterInteractionHandlers(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isSetGamesCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    try {
      return await handlers.handleSetGamesInteraction(interaction, games);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "GAME_FILTER_INTERACTION", "Eroare in handler-ul /set games", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") await interaction.followUp(payload);
        else if (typeof interaction.reply === "function") await interaction.reply(payload);
      } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installGameFilterInteractions, { createGameFilterInteractionHandlers });

export = installGameFilterInteractions;
