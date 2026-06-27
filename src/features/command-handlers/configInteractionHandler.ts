"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";
import type { CurrencyCode, GameConfig, GuildSettings, NotificationMode } from "../../types";
import { clampJoinedList } from "../command-presentation/discordListLimit";

const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;
type InteractionPayload = string | { content?: string; embeds?: ConfigEmbed[]; flags?: number };

interface ConfigEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
}

interface ConfigHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  DEFAULT_CURRENCY: CurrencyCode;
  MessageFlags: { Ephemeral: number };
}

type ConfigContext = ConfigHandlerDeps & { handleInteraction?: NextInteractionHandler };

function onOff(value: boolean | undefined, fallback: boolean): string {
  return (value ?? fallback) ? "on" : "off";
}

function formatChannel(id: string | null | undefined, active: boolean | undefined): string {
  if (!active) return "oprit";
  return id ? `<#${id}>` : "neconfigurat";
}

function formatRole(id: string | null | undefined): string {
  return id ? `<@&${id}>` : "neconfigurat";
}

function formatAdminAlertChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : "oprit";
}

function formatGames(settings: GuildSettings | null, games: GameConfig[]): string {
  const enabled = Array.isArray(settings?.enabledGames) ? settings.enabledGames : [];
  if (!enabled.length) return "toate jocurile configurate";
  const byKey = new Map(games.map(game => [String(game.key).toLowerCase(), game]));
  const items = enabled.map(key => {
    const game = byKey.get(String(key).toLowerCase());
    return game ? `${game.name} (${game.key})` : String(key);
  });
  return clampJoinedList(items, 1024, { separator: ", " });
}

function formatStores(settings: GuildSettings | null): string {
  const stores = Array.isArray(settings?.enabledStores) ? settings.enabledStores : [];
  return stores.length ? stores.join(", ") : "toate magazinele";
}

function buildConfigEmbed(settings: GuildSettings | null, games: GameConfig[], defaultCurrency: CurrencyCode): ConfigEmbed {
  const mode: NotificationMode = settings?.notificationMode === "compact" ? "compact" : "detailed";
  const minDiscount = Number.isFinite(settings?.minDiscountPercent) ? Number(settings?.minDiscountPercent) : 70;
  const maxPrice = Number.isFinite(settings?.maxAbsolutePrice) ? Number(settings?.maxAbsolutePrice) : 0;
  const currency = String(settings?.currency || defaultCurrency);

  return {
    title: "Configuratie server",
    description: "Setarile active pentru notificari, reduceri, roluri si canale.",
    color: 0x3498db,
    fields: [
      {
        name: "Afisare si filtre",
        value: [
          `mode: ${mode}`,
          `mindiscount: ${minDiscount}%`,
          `maxprice: ${maxPrice > 0 ? maxPrice : "fara limita"}`,
          `free: ${onOff(settings?.includeFreeGames, true)}`,
          `paid: ${onOff(settings?.includePaidDiscounts, true)}`,
          `currency: ${currency}`,
          `stores: ${formatStores(settings)}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Jocuri",
        value: formatGames(settings, games),
        inline: false
      },
      {
        name: "Roluri si canale",
        value: [
          `rol update: ${formatRole(settings?.notificationRoleId)}`,
          `rol reduceri: ${formatRole(settings?.discountRoleId)}`,
          `canal update: ${formatChannel(settings?.notificationChannelId, settings?.subscribed)}`,
          `canal reduceri: ${formatChannel(settings?.discountChannelId, settings?.discountsSubscribed)}`,
          `canal YouTube: ${formatChannel(settings?.youtubeNotificationChannelId, settings?.youtubeNotificationsEnabled)}`,
          `canal alerte admin: ${formatAdminAlertChannel(settings?.adminAlertChannelId)}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Alerte de pret",
        value: `${Array.isArray(settings?.priceAlerts) ? settings.priceAlerts.length : 0} configurate`,
        inline: false
      },
      {
        name: "YouTube",
        value: [
          `${Array.isArray(settings?.youtubeChannels) ? settings.youtubeChannels.length : 0} canale urmarite`,
          `${Array.isArray(settings?.youtubeChannelRoutes) ? settings.youtubeChannelRoutes.reduce((total, route) => total + route.discordChannelIds.length, 0) : 0} rute speciale`,
          `${Array.isArray(settings?.youtubeTitleIncludeWords) ? settings.youtubeTitleIncludeWords.length : 0} filtre de titlu`,
          `sablon mesaj: ${settings?.youtubeMessageTemplate ? "personalizat" : "implicit"}`
        ].join("\n"),
        inline: false
      }
    ]
  };
}

function createConfigInteractionHandler(deps: ConfigHandlerDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, getGuildSettings, DEFAULT_CURRENCY, MessageFlags } = deps;

  async function handleConfigInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) {
      return interaction.reply({ content: "Eroare: comanda /config merge doar pe un server.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "config"))) return undefined;
    const endLog = startCommandLog(interaction, "config");
    await safeDefer(interaction, true);
    const settings = await getGuildSettings(guildId);
    const embed = buildConfigEmbed(settings, games, DEFAULT_CURRENCY);
    endLog("ok");
    return safeEdit(interaction, { embeds: [embed] });
  }

  return { handleConfigInteraction };
}

function isConfigCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "config";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }): InteractionPayload {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

type ConfigInstaller = ((target: ConfigContext) => void) & {
  createConfigInteractionHandler: typeof createConfigInteractionHandler;
  buildConfigEmbed: typeof buildConfigEmbed;
  buildCommandHandler: typeof buildConfigCommandHandler;
};

function buildConfigCommandHandler(target: ConfigContext) {
  const handlers = createConfigInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getGuildSettings: target.getGuildSettings,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isConfigCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        return await handlers.handleConfigInteraction(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "CONFIG_INTERACTION", "Eroare in handler-ul /config", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

const installConfigInteraction = ((target: ConfigContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildConfigCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}) as ConfigInstaller;

installConfigInteraction.buildCommandHandler = buildConfigCommandHandler;
installConfigInteraction.createConfigInteractionHandler = createConfigInteractionHandler;
installConfigInteraction.buildConfigEmbed = buildConfigEmbed;

export = installConfigInteraction;
