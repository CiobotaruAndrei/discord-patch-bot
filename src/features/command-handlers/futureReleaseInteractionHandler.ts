"use strict";

import type { DiscordReplyPayload, FutureReleaseGameEntry, GameConfig, GuildSettings } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { clampJoinedList } from "../command-presentation/discordListLimit.js";
import { deleteFutureReleaseGame, listFutureReleaseGames, saveFutureReleaseGame, startFutureReleaseNotifications, stopFutureReleaseNotifications } from "../admin-records/futureReleaseGamesRepository.js";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText.js";

import { errorDetail } from "../../shared/errors.js";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordChannel {
  id: string;
}

interface ChannelPermissions {
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  channel?: DiscordChannel | null;
  client?: { user?: { id: string } | null } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface FutureReleaseDeps {
  GuildModel: Parameters<typeof saveFutureReleaseGame>[0];
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  canSendEmbeds(channel: DiscordChannel | null | undefined, botId: string): boolean;
  listMissingChannelPerms(channel: DiscordChannel | null | undefined, botId: string): string[] | null;
  missingChannelPermsMessage(missing?: string[] | null): string;
  checkChannelPermissions(interaction: DiscordInteraction, channelId: string): Promise<ChannelPermissions | null>;
  makeActivationId(): string;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type FutureReleaseContext = FutureReleaseDeps;

function normalizeGameName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 120);
}

function futureReleaseStateLine(settings?: GuildSettings | null): string {
  if (!settings?.futureReleaseSubscribed) return "Notificari: OFF";
  if (!settings.futureReleaseChannelId) {
    return "Notificari: ON, dar canalul lipseste - ruleaza `/future-release start` ca sa il setezi";
  }
  return `Notificari: ON in <#${settings.futureReleaseChannelId}>`;
}

function renderFutureReleaseGames(entries: FutureReleaseGameEntry[], settings?: GuildSettings | null): string {
  if (!entries.length) return "Nu exista jocuri future-release urmarite pentru acest server.";
  const state = futureReleaseStateLine(settings);
  const lines = entries.map(entry => {
    const release = entry.releaseDate ? `lansare: ${escapeInlineText(entry.releaseDate, 40)}` : "lansare: indisponibila";
    const preorder = entry.preorderPrice ? `preorder: ${escapeInlineText(entry.preorderPrice, 80)}` : "preorder: indisponibil";
    return `- \`${escapeInlineText(entry.gameName, 120)}\` | ${release} | ${preorder}`;
  });
  return `${state}\nJocuri future-release (${entries.length}/20):\n${clampJoinedList(lines, 1900)}`;
}

function createFutureReleaseInteractionHandler(deps: FutureReleaseDeps) {
  const {
    GuildModel, getGuildSettings, safeDefer, safeEdit,
    canSendEmbeds, listMissingChannelPerms, missingChannelPermsMessage, makeActivationId
  } = deps;

  async function handleAdd(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const gameName = normalizeGameName(String(interaction.options.getString("game", true) || ""));
    if (!gameName) return safeEdit(interaction, "Eroare: trebuie sa scrii numele jocului.");
    const settings = await getGuildSettings(guildId);
    const existing = listFutureReleaseGames(settings);
    if (!existing.some(entry => entry.gameName === gameName) && existing.length >= 20) {
      return safeEdit(interaction, "Eroare: lista future-release poate avea maxim 20 de jocuri.");
    }
    const { record, saved } = await saveFutureReleaseGame(GuildModel, guildId, {
      gameName,
      releaseDate: String(interaction.options.getString("release-date") || "").trim().slice(0, 40),
      preorderPrice: String(interaction.options.getString("preorder-price") || "").trim().slice(0, 80),
      addedBy: interaction.user?.id || ""
    });
    if (!saved) {
      return safeEdit(interaction, "Eroare: lista future-release poate avea maxim 20 de jocuri (o comanda concurenta a ocupat ultimul loc).");
    }
    return safeEdit(interaction, `OK: \`${record.gameName}\` a fost adaugat in lista future-release.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    return safeEdit(interaction, { content: renderFutureReleaseGames(listFutureReleaseGames(settings), settings), allowedMentions: NO_MENTIONS });
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const gameName = normalizeGameName(String(interaction.options.getString("game", true) || ""));
    if (!gameName) return safeEdit(interaction, "Eroare: trebuie sa scrii numele jocului de sters.");
    const deleted = await deleteFutureReleaseGame(GuildModel, guildId, gameName);
    return deleted
      ? safeEdit(interaction, `OK: \`${gameName}\` a fost sters din lista future-release.`)
      : safeEdit(interaction, `Nu am gasit \`${gameName}\` in lista future-release.`);
  }

  async function handleStart(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const botId = interaction.client?.user?.id;
    if (!botId || !canSendEmbeds(interaction.channel, botId)) {
      return safeEdit(interaction, missingChannelPermsMessage(botId ? listMissingChannelPerms(interaction.channel, botId) : null));
    }
    if (!interaction.channel?.id) return safeEdit(interaction, missingChannelPermsMessage());
    const activationId = makeActivationId();
    await startFutureReleaseNotifications(GuildModel, guildId, interaction.channel.id, activationId);
    return safeEdit(interaction, `OK: future-release este activ pe <#${interaction.channel.id}>. Botul foloseste lista din \`/future-release list\`.`);
  }

  async function handleStop(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    await stopFutureReleaseNotifications(GuildModel, guildId);
    return safeEdit(interaction, "OK: notificarile future-release au fost oprite pentru acest server.");
  }

  async function handleFutureRelease(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const subcommand = interaction.options.getSubcommand();
    await safeDefer(interaction, subcommand !== "list");
    if (subcommand === "add") return handleAdd(interaction, guildId);
    if (subcommand === "list") return handleList(interaction, guildId);
    if (subcommand === "delete") return handleDelete(interaction, guildId);
    if (subcommand === "start") return handleStart(interaction, guildId);
    if (subcommand === "stop") return handleStop(interaction, guildId);
    return safeEdit(interaction, `Eroare: subcomanda \`/future-release ${subcommand}\` nu este recunoscuta.`);
  }

  return { handleFutureRelease };
}

function isFutureReleaseCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["future-release"] });
}

function buildFutureReleaseCommandHandler(target: FutureReleaseContext) {
  const handlers = createFutureReleaseInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isFutureReleaseCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleFutureRelease(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "FUTURE_RELEASE_COMMAND", "Eroare in /future-release", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa comanda future-release.", flags: target.MessageFlags.Ephemeral };
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

export default {
  createFutureReleaseInteractionHandler,
  renderFutureReleaseGames,
  buildCommandHandler: buildFutureReleaseCommandHandler
};
