"use strict";

import type { CurrencyCode, GameConfig } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | Record<string, unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordChannel {
  id: string;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(required?: boolean): string;
    getBoolean(name: string, required?: boolean): boolean | null;
    getChannel(name: string, required?: boolean): DiscordChannel | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface ChannelPermissions {
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

interface GuildConfigurationAdminDeps {
  GuildModel: {
    updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: Record<string, unknown>
    ): Promise<unknown>;
  };
  invalidateGuildCache(guildId: string): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  checkChannelPermissions(interaction: DiscordInteraction, channelId: string): Promise<ChannelPermissions | null>;
  DEFAULT_CURRENCY: CurrencyCode;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type GuildConfigurationAdminContext = GuildConfigurationAdminDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function buildResetConfiguration(defaultCurrency: CurrencyCode): Record<string, unknown> {
  return {
    subscribed: false,
    notificationChannelId: null,
    pendingUpdates: {},
    discountsSubscribed: false,
    discountChannelId: null,
    pendingDiscounts: [],
    notificationDeadLetter: [],
    minDiscountPercent: 70,
    includeFreeGames: true,
    includePaidDiscounts: true,
    notificationMode: "detailed",
    currency: defaultCurrency,
    outboxRecoveryVerify: false,
    lastProcessedGameKey: null,
    seenHashVersionUpdates: 0,
    seenHashVersionDiscounts: 0,
    updatesInitializing: false,
    updatesActivationId: null,
    updatesLastError: { message: "", channelId: null, at: null },
    discountsInitializing: false,
    discountsActivationId: null,
    discountsLastError: { message: "", channelId: null, at: null },
    enabledGames: [],
    commandSnoozes: {},
    enabledStores: [],
    maxAbsolutePrice: 0,
    notificationRoleId: null,
    discountRoleId: null,
    adminAlertChannelId: null,
    priceAlerts: [],
    youtubeChannels: [],
    youtubeNotificationChannelId: null,
    youtubeNotificationsEnabled: false,
    youtubeFilters: {
      excludeShorts: true,
      excludeLives: true,
      excludePremieres: true,
      minDurationSeconds: 0
    },
    youtubeErrors: []
  };
}

function createGuildConfigurationAdminHandler(deps: GuildConfigurationAdminDeps) {
  const {
    GuildModel, invalidateGuildCache, safeDefer, safeEdit,
    checkChannelPermissions, DEFAULT_CURRENCY
  } = deps;

  async function handleResetConfiguration(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (interaction.options.getBoolean("confirm", true) !== true) {
      return safeEdit(interaction, "Resetarea a fost anulata. Foloseste `confirm:true` numai daca vrei sa stergi toate setarile serverului.");
    }
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: buildResetConfiguration(DEFAULT_CURRENCY) },
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    return safeEdit(interaction, "OK: configuratia serverului a fost resetata la valorile implicite. Istoricul rapoartelor si notificarilor nu a fost sters.");
  }

  async function handleAdminAlerts(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "off") {
      await GuildModel.updateOne({ _id: guildId }, { $set: { adminAlertChannelId: null } }, { upsert: true });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: alertele administrative Discord au fost oprite pentru acest server.");
    }
    if (subcommand !== "set") {
      return safeEdit(interaction, `Eroare: subcomanda \`/admin-alerts ${subcommand}\` nu este recunoscuta.`);
    }
    const channel = interaction.options.getChannel("channel", true);
    if (!channel?.id) return safeEdit(interaction, "Eroare: trebuie sa alegi un canal valid.");
    const permissions = await checkChannelPermissions(interaction, channel.id);
    if (!permissions) {
      return safeEdit(interaction, "Eroare: nu am putut verifica permisiunile botului pe canalul ales.");
    }
    const missing = [
      !permissions.sendMessages ? "Send Messages" : "",
      !permissions.embedLinks ? "Embed Links" : ""
    ].filter(Boolean);
    if (missing.length) {
      return safeEdit(interaction, `Eroare: botului ii lipsesc permisiunile ${missing.join(", ")} pe <#${channel.id}>.`);
    }
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: { adminAlertChannelId: channel.id } },
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: alertele administrative vor fi trimise in <#${channel.id}>.`);
  }

  async function handleGuildConfigurationAdmin(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    if (interaction.commandName === "reset-config") return handleResetConfiguration(interaction, guildId);
    return handleAdminAlerts(interaction, guildId);
  }

  return { handleGuildConfigurationAdmin };
}

function isGuildConfigurationAdminCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && (interaction.commandName === "reset-config" || interaction.commandName === "admin-alerts");
}

function buildGuildConfigurationAdminCommandHandler(target: GuildConfigurationAdminContext) {
  const handlers = createGuildConfigurationAdminHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isGuildConfigurationAdminCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleGuildConfigurationAdmin(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "GUILD_CONFIG_ADMIN", "Eroare in comenzile administrative de configurare", errorDetail(err));
        const payload = { content: "Eroare: nu am putut actualiza configuratia serverului.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

const installGuildConfigurationAdminHandler = ((target: GuildConfigurationAdminContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildGuildConfigurationAdminCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: GuildConfigurationAdminContext) => void) & {
  createGuildConfigurationAdminHandler: typeof createGuildConfigurationAdminHandler;
  buildResetConfiguration: typeof buildResetConfiguration;
  buildCommandHandler: typeof buildGuildConfigurationAdminCommandHandler;
};

installGuildConfigurationAdminHandler.createGuildConfigurationAdminHandler = createGuildConfigurationAdminHandler;
installGuildConfigurationAdminHandler.buildResetConfiguration = buildResetConfiguration;
installGuildConfigurationAdminHandler.buildCommandHandler = buildGuildConfigurationAdminCommandHandler;

export = installGuildConfigurationAdminHandler;
