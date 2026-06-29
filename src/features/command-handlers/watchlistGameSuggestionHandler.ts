"use strict";

import type { GameConfig, GuildSettings, WatchlistGameSuggestionEntry } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";
import { deleteWatchlistGameSuggestion, listWatchlistGameSuggestions, recordBotAuditEntry, saveWatchlistGameSuggestion } from "../admin-records/adminRecordsRepository";
import { requireGuildAdminAudited } from "../command-security/runtimeAdminAudit";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");
const defaultRequireGuildAdmin = require("../command-security/adminPermissionGuard") as RequireGuildAdmin;

type InteractionPayload = string | Record<string, unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type RequireGuildAdmin = (interaction: DiscordInteraction) => Promise<boolean>;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface WatchlistGameSuggestionDeps {
  GuildModel: Parameters<typeof saveWatchlistGameSuggestion>[0];
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  invalidateGuildCache(guildId: string): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  requireGuildAdmin: RequireGuildAdmin;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type WatchlistGameSuggestionContext = Omit<WatchlistGameSuggestionDeps, "requireGuildAdmin"> & {
  requireGuildAdmin?: RequireGuildAdmin;
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function normalizeGameName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 100);
}

function formatUserReference(userId: string): string {
  return userId ? `<@${userId}>` : "user necunoscut";
}

function renderWatchlistGameSuggestions(entries: WatchlistGameSuggestionEntry[]): string {
  if (!entries.length) return "Nu exista jocuri propuse pentru watchlist pe acest server.";
  const lines = entries.map(entry => `- \`${escapeInlineText(entry.gameName, 100)}\` propus de ${formatUserReference(entry.createdBy || "")}`);
  return `Jocuri propuse pentru watchlist (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function createWatchlistGameSuggestionHandler(deps: WatchlistGameSuggestionDeps) {
  const { GuildModel, getGuildSettings, invalidateGuildCache, safeDefer, safeEdit, requireGuildAdmin } = deps;

  async function handleAdd(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const gameName = normalizeGameName(String(interaction.options.getString("game", true) || ""));
    if (!gameName) return safeEdit(interaction, "Eroare: trebuie sa scrii numele jocului propus.");
    const record = await saveWatchlistGameSuggestion(GuildModel, guildId, {
      gameName,
      createdBy: interaction.user?.id || ""
    });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: jocul \`${record.gameName}\` a fost adaugat in lista de propuneri.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const limit = Math.max(1, Math.min(25, interaction.options.getInteger("numar") ?? 10));
    const settings = await getGuildSettings(guildId);
    return safeEdit(interaction, { content: renderWatchlistGameSuggestions(listWatchlistGameSuggestions(settings, limit)), allowedMentions: NO_MENTIONS });
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await requireGuildAdminAudited(requireGuildAdmin, GuildModel, interaction, guildId, "/watchlist-game delete"))) return undefined;
    const gameName = normalizeGameName(String(interaction.options.getString("game", true) || ""));
    if (!gameName) return safeEdit(interaction, "Eroare: trebuie sa scrii numele jocului de sters.");
    const deleted = await deleteWatchlistGameSuggestion(GuildModel, guildId, gameName);
    invalidateGuildCache(guildId);
    await recordBotAuditEntry(GuildModel, guildId, {
      userId: interaction.user?.id || "",
      command: "/watchlist-game delete",
      result: "Access granted.",
      details: deleted ? `stearsa: ${gameName}` : `negasita: ${gameName}`
    }).catch(() => undefined);
    return deleted
      ? safeEdit(interaction, `OK: jocul \`${gameName}\` a fost sters din propunerile watchlist.`)
      : safeEdit(interaction, `Nu am gasit jocul \`${gameName}\` in propunerile watchlist.`);
  }

  async function handleWatchlistGameSuggestion(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "add") return handleAdd(interaction, guildId);
    if (subcommand === "list") return handleList(interaction, guildId);
    if (subcommand === "delete") return handleDelete(interaction, guildId);
    return safeEdit(interaction, `Eroare: subcomanda \`/watchlist-game ${subcommand}\` nu este recunoscuta.`);
  }

  return { handleWatchlistGameSuggestion };
}

function isWatchlistGameSuggestionCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "watchlist-game";
}

function buildWatchlistGameSuggestionCommandHandler(target: WatchlistGameSuggestionContext) {
  const handlers = createWatchlistGameSuggestionHandler({
    GuildModel: target.GuildModel,
    getGuildSettings: target.getGuildSettings,
    invalidateGuildCache: target.invalidateGuildCache,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    requireGuildAdmin: target.requireGuildAdmin || defaultRequireGuildAdmin,
    logger: target.logger,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isWatchlistGameSuggestionCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleWatchlistGameSuggestion(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "WATCHLIST_GAME_COMMAND", "Eroare in /watchlist-game", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa propunerea watchlist.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") await interaction.followUp(payload);
          else if (typeof interaction.reply === "function") await interaction.reply(payload);
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

const installWatchlistGameSuggestionHandler = ((target: WatchlistGameSuggestionContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildWatchlistGameSuggestionCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: WatchlistGameSuggestionContext) => void) & {
  createWatchlistGameSuggestionHandler: typeof createWatchlistGameSuggestionHandler;
  renderWatchlistGameSuggestions: typeof renderWatchlistGameSuggestions;
  buildCommandHandler: typeof buildWatchlistGameSuggestionCommandHandler;
};

installWatchlistGameSuggestionHandler.createWatchlistGameSuggestionHandler = createWatchlistGameSuggestionHandler;
installWatchlistGameSuggestionHandler.renderWatchlistGameSuggestions = renderWatchlistGameSuggestions;
installWatchlistGameSuggestionHandler.buildCommandHandler = buildWatchlistGameSuggestionCommandHandler;

export = installWatchlistGameSuggestionHandler;
