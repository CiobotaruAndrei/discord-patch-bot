"use strict";

import type {
  GuildSettings,
  LoggerFunction,
  YouTubeChannelSubscription,
  YouTubeFilters,
  YouTubeVideo
} from "../../types";
import type { CommandGame, CommandHandler } from "../command-registry/commandHandler";
import type { ResolvedYouTubeChannel } from "../youtube/youtubeSource";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | { content?: string; embeds?: object[]; flags?: number };

interface DiscordChannel {
  id: string;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  options: {
    getSubcommand(): string;
    getSubcommandGroup(required?: boolean): string | null;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
    getChannel(name: string, required?: boolean): DiscordChannel | null;
  };
  reply?(payload: InteractionPayload): Promise<unknown>;
  followUp?(payload: InteractionPayload): Promise<unknown>;
}

interface MongoWriteResult {
  matchedCount?: number;
  modifiedCount?: number;
}

interface ChannelPermissions {
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

interface YouTubeInteractionDeps {
  GuildModel: {
    updateOne(filter: object, update: object, options?: object): Promise<MongoWriteResult>;
  };
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  invalidateGuildCache(guildId: string): void;
  resolveYouTubeChannel(input: string): Promise<ResolvedYouTubeChannel>;
  fetchYouTubeFeed(channel: ResolvedYouTubeChannel): Promise<YouTubeVideo[]>;
  seedSeenVideos(guildId: string, channelId: string, videos: YouTubeVideo[]): Promise<void>;
  removeSeenChannel(guildId: string, channelId: string): Promise<void>;
  clearYouTubeErrors(guildId: string): Promise<void>;
  checkChannelPermissions(interaction: DiscordInteraction, channelId: string): Promise<ChannelPermissions | null>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  formatUserError(error: unknown, fallback: string): string;
  logger: LoggerFunction;
  MessageFlags: { Ephemeral: number };
}

type YouTubeContext = YouTubeInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: CommandGame[]) => Promise<unknown> | unknown;
};

const MAX_YOUTUBE_CHANNELS = 25;

function defaultFilters(settings: GuildSettings | null): Required<YouTubeFilters> {
  return {
    excludeShorts: settings?.youtubeFilters?.excludeShorts ?? true,
    excludeLives: settings?.youtubeFilters?.excludeLives ?? true,
    excludePremieres: settings?.youtubeFilters?.excludePremieres ?? true,
    minDurationSeconds: Number(settings?.youtubeFilters?.minDurationSeconds ?? 0)
  };
}

function onOff(value: boolean): string {
  return value ? "ON" : "OFF";
}

function formatTime(value: Date | string | null | undefined): string {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) && time > 0 ? `<t:${Math.floor(time / 1000)}:R>` : "niciodata";
}

function formatYouTubeList(settings: GuildSettings | null): string {
  const channels = settings?.youtubeChannels || [];
  if (!channels.length) return "Nu exista canale YouTube urmarite.";
  return channels.map((channel, index) => {
    const error = channel.lastError?.message ? `, ultima eroare: ${channel.lastError.message}` : "";
    return `${index + 1}. **${channel.channelName}** (\`${channel.channelId}\`) - ultima verificare ${formatTime(channel.lastCheckedAt)}${error}`;
  }).join("\n");
}

function formatFilters(filters: Required<YouTubeFilters>): string {
  return [
    `filtru Shorts: ${onOff(filters.excludeShorts)}`,
    `filtru live: ${onOff(filters.excludeLives)}`,
    `filtru premiere: ${onOff(filters.excludePremieres)}`,
    `durata minima: ${filters.minDurationSeconds}s`
  ].join("\n");
}

function formatYouTubeStatus(settings: GuildSettings | null): string {
  const channels = settings?.youtubeChannels || [];
  const lastChecked = channels
    .map(channel => channel.lastCheckedAt ? new Date(channel.lastCheckedAt).getTime() : 0)
    .reduce((latest, value) => Math.max(latest, value), 0);
  return [
    `notificari: ${onOff(settings?.youtubeNotificationsEnabled === true)}`,
    `canal Discord: ${settings?.youtubeNotificationChannelId ? `<#${settings.youtubeNotificationChannelId}>` : "neconfigurat"}`,
    `canale urmarite: ${channels.length}`,
    `ultima verificare: ${lastChecked > 0 ? `<t:${Math.floor(lastChecked / 1000)}:R>` : "niciodata"}`,
    `erori recente: ${settings?.youtubeErrors?.length || 0}`,
    formatFilters(defaultFilters(settings))
  ].join("\n");
}

function createYouTubeInteractionHandler(deps: YouTubeInteractionDeps) {
  const {
    GuildModel,
    getGuildSettings,
    invalidateGuildCache,
    resolveYouTubeChannel,
    fetchYouTubeFeed,
    seedSeenVideos,
    removeSeenChannel,
    clearYouTubeErrors,
    checkChannelPermissions,
    safeDefer,
    safeEdit
  } = deps;

  async function subscribe(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const input = interaction.options.getString("canal", true);
    if (!input) return safeEdit(interaction, "Eroare: trebuie sa introduci canalul YouTube.");
    const settings = await getGuildSettings(guildId);
    const channels = settings?.youtubeChannels || [];
    if (channels.length >= MAX_YOUTUBE_CHANNELS) {
      return safeEdit(interaction, `Eroare: serverul a atins limita de ${MAX_YOUTUBE_CHANNELS} canale YouTube.`);
    }
    const resolved = await resolveYouTubeChannel(input);
    if (channels.some(channel => channel.channelId === resolved.channelId)) {
      return safeEdit(interaction, `Info: **${resolved.channelName}** este deja urmarit.`);
    }
    const videos = await fetchYouTubeFeed(resolved);
    await seedSeenVideos(guildId, resolved.channelId, videos);
    const now = new Date();
    const subscription: YouTubeChannelSubscription = {
      ...resolved,
      subscribedAt: now,
      lastCheckedAt: now,
      lastVideoId: videos[0]?.videoId || "",
      lastError: { message: "", channelId: null, at: null }
    };
    const result = await GuildModel.updateOne(
      {
        _id: guildId,
        "youtubeChannels.channelId": { $ne: resolved.channelId }
      },
      { $push: { youtubeChannels: subscription } },
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    if ((result.modifiedCount ?? 0) === 0 && (result.matchedCount ?? 0) > 0) {
      return safeEdit(interaction, `Info: **${resolved.channelName}** este deja urmarit.`);
    }
    return safeEdit(
      interaction,
      `OK: **${resolved.channelName}** a fost adaugat. Am memorat ${videos.length} videoclipuri existente ca baseline, deci nu vor fi postate retroactiv.`
    );
  }

  async function unsubscribe(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const channelId = interaction.options.getString("canal", true);
    if (!channelId) return safeEdit(interaction, "Eroare: trebuie sa alegi un canal urmarit.");
    const settings = await getGuildSettings(guildId);
    const channel = settings?.youtubeChannels?.find(item => item.channelId === channelId);
    const result = await GuildModel.updateOne(
      { _id: guildId },
      { $pull: { youtubeChannels: { channelId } } }
    );
    if ((result.modifiedCount ?? 0) === 0) {
      return safeEdit(interaction, `Info: canalul \`${channelId}\` nu era urmarit.`);
    }
    await removeSeenChannel(guildId, channelId);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: **${channel?.channelName || channelId}** nu mai este urmarit.`);
  }

  async function notify(interaction: DiscordInteraction, guildId: string, subcommand: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    if (subcommand === "channel") {
      const channel = interaction.options.getChannel("channel", true);
      if (!channel?.id) return safeEdit(interaction, "Eroare: trebuie sa alegi un canal Discord valid.");
      const permissions = await checkChannelPermissions(interaction, channel.id);
      if (!permissions) return safeEdit(interaction, "Eroare: nu am putut verifica permisiunile botului pe canal.");
      const missing = [
        !permissions.sendMessages ? "Send Messages" : "",
        !permissions.embedLinks ? "Embed Links" : ""
      ].filter(Boolean);
      if (missing.length) {
        return safeEdit(interaction, `Eroare: botului ii lipsesc permisiunile ${missing.join(", ")} pe <#${channel.id}>.`);
      }
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: { youtubeNotificationChannelId: channel.id } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: notificarile YouTube vor fi postate in <#${channel.id}>.`);
    }
    if (subcommand === "on") {
      if (!settings?.youtubeNotificationChannelId) {
        return safeEdit(interaction, "Eroare: seteaza mai intai canalul cu `/youtube notify channel`.");
      }
      if (!settings.youtubeChannels?.length) {
        return safeEdit(interaction, "Eroare: adauga mai intai cel putin un canal cu `/youtube subscribe`.");
      }
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: { youtubeNotificationsEnabled: true } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: notificarile YouTube sunt active in <#${settings.youtubeNotificationChannelId}>.`);
    }
    if (subcommand === "off") {
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: { youtubeNotificationsEnabled: false } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: notificarile YouTube sunt oprite. Canalele urmarite raman salvate.");
    }
    return safeEdit(interaction, formatYouTubeStatus(settings));
  }

  async function filter(interaction: DiscordInteraction, guildId: string, subcommand: string): Promise<unknown> {
    const fieldBySubcommand: Record<string, keyof YouTubeFilters> = {
      shorts: "excludeShorts",
      lives: "excludeLives",
      premieres: "excludePremieres"
    };
    if (subcommand === "status") {
      return safeEdit(interaction, formatFilters(defaultFilters(await getGuildSettings(guildId))));
    }
    if (subcommand === "min-duration") {
      const seconds = interaction.options.getInteger("seconds", true);
      if (seconds === null || seconds < 0 || seconds > 86400) {
        return safeEdit(interaction, "Eroare: durata minima trebuie sa fie intre 0 si 86400 secunde.");
      }
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: { "youtubeFilters.minDurationSeconds": seconds } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: durata minima YouTube este ${seconds}s.`);
    }
    const field = fieldBySubcommand[subcommand];
    const state = interaction.options.getString("state", true);
    if (!field || (state !== "on" && state !== "off")) {
      return safeEdit(interaction, "Eroare: filtrul sau starea on/off nu este valida.");
    }
    const enabled = state === "on";
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: { [`youtubeFilters.${field}`]: enabled } },
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: filtrul YouTube ${subcommand} este ${onOff(enabled)}.`);
  }

  async function errors(guildId: string): Promise<InteractionPayload> {
    const entries = (await getGuildSettings(guildId))?.youtubeErrors || [];
    if (!entries.length) return safeEditPlaceholder("Nu exista erori YouTube inregistrate.");
    const lines = entries.slice(-10).reverse().map(entry =>
      `- ${formatTime(entry.at)} - **${entry.channelName || entry.channelId || "YouTube"}**: ${entry.message}`
    );
    return safeEditPlaceholder(`Ultimele erori YouTube:\n${lines.join("\n")}`);
  }

  function safeEditPlaceholder(content: string): InteractionPayload {
    return { content };
  }

  async function permissions(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    const channelId = settings?.youtubeNotificationChannelId;
    if (!channelId) return safeEdit(interaction, "Canalul Discord pentru YouTube nu este configurat.");
    const resolved = await checkChannelPermissions(interaction, channelId);
    if (!resolved) return safeEdit(interaction, `Nu am putut verifica permisiunile pe <#${channelId}>.`);
    return safeEdit(interaction, [
      `Permisiuni YouTube pe <#${channelId}>:`,
      `View Channel: verificat prin accesul la canal`,
      `Send Messages: ${onOff(resolved.sendMessages)}`,
      `Embed Links: ${onOff(resolved.embedLinks)}`,
      `Read Message History: ${onOff(resolved.readMessageHistory)}`
    ].join("\n"));
  }

  async function handleYouTubeInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    if (group === "notify") return notify(interaction, guildId, subcommand);
    if (group === "filter") return filter(interaction, guildId, subcommand);
    if (subcommand === "subscribe") return subscribe(interaction, guildId);
    if (subcommand === "unsubscribe") return unsubscribe(interaction, guildId);
    if (subcommand === "list") return safeEdit(interaction, formatYouTubeList(await getGuildSettings(guildId)));
    if (subcommand === "status") return safeEdit(interaction, formatYouTubeStatus(await getGuildSettings(guildId)));
    if (subcommand === "errors") {
      const payload = await errors(guildId);
      return safeEdit(interaction, payload);
    }
    if (subcommand === "permissions") return permissions(interaction, guildId);
    if (subcommand === "clear-errors") {
      await clearYouTubeErrors(guildId);
      return safeEdit(interaction, "OK: istoricul local de erori YouTube a fost curatat.");
    }
    return safeEdit(interaction, `Eroare: subcomanda \`/youtube ${subcommand}\` nu este recunoscuta.`);
  }

  return { handleYouTubeInteraction };
}

function isYouTubeCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "youtube";
}

function buildYouTubeCommandHandler(target: YouTubeContext) {
  const handlers = createYouTubeInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isYouTubeCommand(interaction as DiscordInteraction),
    handle: async interaction => {
      try {
        return await handlers.handleYouTubeInteraction(interaction);
      } catch (error) {
        target.logger("ERROR", "YOUTUBE_COMMAND", "Eroare in comanda /youtube", errorDetail(error));
        const payload = {
          content: target.formatUserError(error, "Eroare la procesarea comenzii YouTube."),
          flags: target.MessageFlags.Ephemeral
        };
        try {
          if ((interaction.deferred || interaction.replied) && interaction.followUp) {
            await interaction.followUp(payload);
          } else if (interaction.reply) {
            await interaction.reply(payload);
          }
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

const installYouTubeInteractionHandler = ((target: YouTubeContext): void => {
  const previous = target.handleInteraction;
  const { handlers, canHandle, handle } = buildYouTubeCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: CommandGame[]) {
    if (!canHandle(interaction)) return previous?.(interaction, games);
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: YouTubeContext) => void) & {
  createYouTubeInteractionHandler: typeof createYouTubeInteractionHandler;
  buildCommandHandler: typeof buildYouTubeCommandHandler;
  formatYouTubeList: typeof formatYouTubeList;
  formatYouTubeStatus: typeof formatYouTubeStatus;
};

installYouTubeInteractionHandler.createYouTubeInteractionHandler = createYouTubeInteractionHandler;
installYouTubeInteractionHandler.buildCommandHandler = buildYouTubeCommandHandler;
installYouTubeInteractionHandler.formatYouTubeList = formatYouTubeList;
installYouTubeInteractionHandler.formatYouTubeStatus = formatYouTubeStatus;

export = installYouTubeInteractionHandler;
