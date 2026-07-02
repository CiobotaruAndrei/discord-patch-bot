"use strict";

import type { FutureReleaseGameEntry, GameConfig, GuildSettings } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";
import { deleteFutureReleaseGame, listFutureReleaseGames, saveFutureReleaseGame } from "../admin-records/futureReleaseGamesRepository";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | Record<string, unknown>;
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
  invalidateGuildCache(guildId: string): void;
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

type FutureReleaseContext = FutureReleaseDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

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
    GuildModel, getGuildSettings, invalidateGuildCache, safeDefer, safeEdit,
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
    invalidateGuildCache(guildId);
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
    invalidateGuildCache(guildId);
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
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          futureReleaseSubscribed: true,
          futureReleaseChannelId: interaction.channel.id,
          futureReleaseInitializing: false,
          futureReleaseActivationId: activationId
        }
      },
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: future-release este activ pe <#${interaction.channel.id}>. Botul foloseste lista din \`/future-release list\`.`);
  }

  async function handleStop(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          futureReleaseSubscribed: false,
          futureReleaseChannelId: null,
          futureReleaseInitializing: false
        },
        $unset: { futureReleaseActivationId: "" }
      }
    );
    invalidateGuildCache(guildId);
    return safeEdit(interaction, "OK: notificarile future-release au fost oprite pentru acest server.");
  }

  async function handleFutureRelease(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const subcommand = interaction.options.getSubcommand();
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
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "future-release";
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

const installFutureReleaseInteractionHandler = ((target: FutureReleaseContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildFutureReleaseCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: FutureReleaseContext) => void) & {
  createFutureReleaseInteractionHandler: typeof createFutureReleaseInteractionHandler;
  renderFutureReleaseGames: typeof renderFutureReleaseGames;
  buildCommandHandler: typeof buildFutureReleaseCommandHandler;
};

installFutureReleaseInteractionHandler.createFutureReleaseInteractionHandler = createFutureReleaseInteractionHandler;
installFutureReleaseInteractionHandler.renderFutureReleaseGames = renderFutureReleaseGames;
installFutureReleaseInteractionHandler.buildCommandHandler = buildFutureReleaseCommandHandler;

export = installFutureReleaseInteractionHandler;
