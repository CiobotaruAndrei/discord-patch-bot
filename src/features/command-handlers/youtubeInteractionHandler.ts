"use strict";

import type {
  GuildSettings,
  LoggerFunction,
  YouTubeChannelSubscription,
  YouTubeFilters,
  YouTubeVideo
} from "../../types";
import type { CommandGame, CommandHandler } from "../command-registry/commandHandler";
import type { NotificationDiscordClient } from "../notifications/outboundChannel";
import type { ResolvedYouTubeChannel } from "../youtube/youtubeSource";
import type { PreparedVideo } from "../youtube/youtubeNotificationService";
import {
  DEFAULT_YOUTUBE_MESSAGE_TEMPLATE,
  MAX_YOUTUBE_ROUTE_DESTINATIONS,
  YOUTUBE_TITLE_WORD_LIMIT,
  isRecentYouTubeVideo,
  normalizeYouTubeTitleWord,
  parseDiscordChannelReference,
  validateYouTubeMessageTemplate,
  youtubeDestinationIds
} from "../youtube/youtubeDeliveryPolicy";
import { clampJoinedList } from "../command-presentation/discordListLimit";

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
  client?: NotificationDiscordClient;
  isChatInputCommand?: () => boolean;
  options: {
    getSubcommand(): string;
    getSubcommandGroup(required?: boolean): string | null;
    getString(name: string, required?: boolean): string | null;
    getBoolean(name: string, required?: boolean): boolean | null;
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
  showYouTubeVideos(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    selectedChannelId: string
  ): Promise<{ videos: number; batches: number; destinations: number }>;
  prepareManualYouTubeVideos(guild: GuildSettings, selectedChannelId: string, force?: boolean): Promise<PreparedVideo[]>;
  deliverManualYouTubeVideos(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    prepared: PreparedVideo[],
    bypassOutbox?: boolean,
    claimed?: boolean
  ): Promise<{ videos: number; batches: number; destinations: number }>;
  checkChannelPermissions(interaction: DiscordInteraction, channelId: string): Promise<ChannelPermissions | null>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  formatUserError(error: unknown, fallback: string): string;
  logger: LoggerFunction;
  MessageFlags: { Ephemeral: number };
  outboxEnabled?: boolean;
}

type YouTubeContext = YouTubeInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: CommandGame[]) => Promise<unknown> | unknown;
  env?: { NOTIFICATION_OUTBOX_ENABLED?: boolean };
};

const MAX_YOUTUBE_CHANNELS = 25;
const YOUTUBE_MANUAL_IMMEDIATE_BATCH = 5;

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
  const lines = channels.map((channel, index) => {
    const error = channel.lastError?.message ? `, ultima eroare: ${channel.lastError.message}` : "";
    return `${index + 1}. **${channel.channelName}** (\`${channel.channelId}\`) - ultima verificare ${formatTime(channel.lastCheckedAt)}${error}`;
  });
  return clampJoinedList(lines, 2000);
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
    `rute speciale: ${(settings?.youtubeChannelRoutes || []).reduce((total, route) => total + route.discordChannelIds.length, 0)}`,
    `filtre titlu: ${settings?.youtubeTitleIncludeWords?.length || 0}`,
    `sablon mesaj: ${settings?.youtubeMessageTemplate ? "personalizat" : "implicit"}`,
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
    prepareManualYouTubeVideos,
    deliverManualYouTubeVideos,
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
    const now = new Date();
    const olderVideos = videos.filter(video => !isRecentYouTubeVideo(video, now));
    await seedSeenVideos(guildId, resolved.channelId, olderVideos);
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
      `OK: **${resolved.channelName}** a fost adaugat. Am ignorat ${olderVideos.length} videoclipuri mai vechi de o luna; cele recente pot fi livrate la prima activare.`
    );
  }

  async function unsubscribe(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const channelId = interaction.options.getString("canal", true);
    if (!channelId) return safeEdit(interaction, "Eroare: trebuie sa alegi un canal urmarit.");
    const settings = await getGuildSettings(guildId);
    const channel = settings?.youtubeChannels?.find(item => item.channelId === channelId);
    const result = await GuildModel.updateOne(
      { _id: guildId },
      { $pull: { youtubeChannels: { channelId }, youtubeChannelRoutes: { channelId } } }
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
        { $set: { youtubeNotificationsEnabled: true, youtubeHasActivated: true } },
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

  async function messageTemplate(
    interaction: DiscordInteraction,
    guildId: string,
    subcommand: string
  ): Promise<unknown> {
    if (subcommand === "status") {
      const template = (await getGuildSettings(guildId))?.youtubeMessageTemplate || DEFAULT_YOUTUBE_MESSAGE_TEMPLATE;
      return safeEdit(interaction, `Sablon YouTube curent:\n\`\`\`\n${template}\n\`\`\``);
    }
    if (subcommand === "reset") {
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: { youtubeMessageTemplate: null } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: sablonul YouTube a revenit la valoarea implicita:\n\`${DEFAULT_YOUTUBE_MESSAGE_TEMPLATE}\``);
    }
    const rawTemplate = interaction.options.getString("text", true);
    if (!rawTemplate) return safeEdit(interaction, "Eroare: trebuie sa introduci textul sablonului.");
    try {
      const template = validateYouTubeMessageTemplate(rawTemplate);
      await GuildModel.updateOne(
        { _id: guildId },
        { $set: { youtubeMessageTemplate: template } },
        { upsert: true }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: sablonul mesajului YouTube a fost actualizat.");
    } catch (error) {
      return safeEdit(interaction, `Eroare: ${errorDetail(error)}`);
    }
  }

  function formatYouTubeRoutes(settings: GuildSettings | null): string {
    const routes = settings?.youtubeChannelRoutes || [];
    if (!routes.length) return "Nu exista rute speciale YouTube. Toate videoclipurile folosesc canalul principal.";
    const channelNames = new Map((settings?.youtubeChannels || []).map(channel => [channel.channelId, channel.channelName]));
    const lines = routes.map(route => {
      const destinations = route.discordChannelIds.map(channelId => `<#${channelId}>`).join(", ");
      return `- **${channelNames.get(route.channelId) || route.channelId}**: ${destinations || "fara destinatii"}`;
    });
    return clampJoinedList(lines, 2000);
  }

  async function channelRoute(
    interaction: DiscordInteraction,
    guildId: string,
    subcommand: string
  ): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    if (subcommand === "list") return safeEdit(interaction, formatYouTubeRoutes(settings));
    const youtubeChannelId = interaction.options.getString("canal", true);
    const subscription = settings?.youtubeChannels?.find(channel => channel.channelId === youtubeChannelId);
    if (!youtubeChannelId || !subscription) {
      return safeEdit(interaction, "Eroare: alege un canal YouTube urmarit.");
    }
    const existingRoute = (settings?.youtubeChannelRoutes || []).find(route => route.channelId === youtubeChannelId);
    if (subcommand === "add") {
      const discordChannel = interaction.options.getChannel("discord", true);
      if (!discordChannel?.id) return safeEdit(interaction, "Eroare: alege un canal Discord valid.");
      const permissions = await checkChannelPermissions(interaction, discordChannel.id);
      if (!permissions?.sendMessages || !permissions.embedLinks) {
        return safeEdit(interaction, "Eroare: botul are nevoie de Send Messages si Embed Links pe canalul ales.");
      }
      const currentDestinations = existingRoute?.discordChannelIds || [];
      if (!currentDestinations.includes(discordChannel.id) && currentDestinations.length >= MAX_YOUTUBE_ROUTE_DESTINATIONS) {
        return safeEdit(interaction, `Eroare: ai atins limita de ${MAX_YOUTUBE_ROUTE_DESTINATIONS} canale Discord pentru ruta lui **${subscription.channelName}**. Scoate o destinatie cu \`/youtube channel-route remove\` inainte sa adaugi alta.`);
      }
      const update = existingRoute
        ? { $addToSet: { "youtubeChannelRoutes.$[route].discordChannelIds": discordChannel.id } }
        : { $push: { youtubeChannelRoutes: { channelId: youtubeChannelId, discordChannelIds: [discordChannel.id] } } };
      const options = existingRoute
        ? { arrayFilters: [{ "route.channelId": youtubeChannelId }] }
        : { upsert: true };
      await GuildModel.updateOne({ _id: guildId }, update, options);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: videoclipurile de la **${subscription.channelName}** vor fi trimise exclusiv in rutele speciale configurate, inclusiv <#${discordChannel.id}>.`);
    }
    const requested = interaction.options.getString("discord", true);
    if (!requested) return safeEdit(interaction, "Eroare: alege canalul Discord sau valoarea `toate`.");
    if (!existingRoute) return safeEdit(interaction, "Info: canalul YouTube nu are rute speciale configurate.");
    if (requested === "toate") {
      await GuildModel.updateOne(
        { _id: guildId },
        { $pull: { youtubeChannelRoutes: { channelId: youtubeChannelId } } }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: toate rutele speciale pentru **${subscription.channelName}** au fost sterse. Se foloseste din nou canalul principal.`);
    }
    const discordChannelId = parseDiscordChannelReference(requested);
    if (!discordChannelId || !existingRoute.discordChannelIds.includes(discordChannelId)) {
      return safeEdit(interaction, "Eroare: ruta Discord aleasa nu exista pentru acest canal YouTube.");
    }
    const update = existingRoute.discordChannelIds.length === 1
      ? { $pull: { youtubeChannelRoutes: { channelId: youtubeChannelId } } }
      : { $pull: { "youtubeChannelRoutes.$[route].discordChannelIds": discordChannelId } };
    const options = existingRoute.discordChannelIds.length === 1
      ? undefined
      : { arrayFilters: [{ "route.channelId": youtubeChannelId }] };
    await GuildModel.updateOne({ _id: guildId }, update, options);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: ruta <#${discordChannelId}> a fost stearsa pentru **${subscription.channelName}**.`);
  }

  async function titleFilter(
    interaction: DiscordInteraction,
    guildId: string,
    subcommand: string
  ): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    const words = settings?.youtubeTitleIncludeWords || [];
    if (subcommand === "list") {
      const header = "Filtrul inclusiv accepta titluri care contin cel putin una dintre valorile:\n";
      return safeEdit(interaction, words.length
        ? `${header}${clampJoinedList(words.map(word => `- \`${word}\``), 2000 - header.length)}`
        : "Filtrul inclusiv de titlu este gol. Toate titlurile trec acest filtru.");
    }
    if (subcommand === "clear") {
      await GuildModel.updateOne({ _id: guildId }, { $set: { youtubeTitleIncludeWords: [] } }, { upsert: true });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: filtrul inclusiv de titlu a fost golit.");
    }
    const rawWord = interaction.options.getString("word", true);
    if (!rawWord) return safeEdit(interaction, "Eroare: introdu o valoare pentru filtrul de titlu.");
    try {
      const word = normalizeYouTubeTitleWord(rawWord);
      if (subcommand === "add") {
        if (words.length >= YOUTUBE_TITLE_WORD_LIMIT && !words.includes(word)) {
          return safeEdit(interaction, `Eroare: filtrul poate avea cel mult ${YOUTUBE_TITLE_WORD_LIMIT} valori.`);
        }
        await GuildModel.updateOne(
          { _id: guildId },
          { $addToSet: { youtubeTitleIncludeWords: word } },
          { upsert: true }
        );
        invalidateGuildCache(guildId);
        return safeEdit(interaction, `OK: \`${word}\` a fost adaugat in filtrul inclusiv de titlu.`);
      }
      await GuildModel.updateOne(
        { _id: guildId },
        { $pull: { youtubeTitleIncludeWords: word } }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: \`${word}\` a fost eliminat din filtrul inclusiv de titlu.`);
    } catch (error) {
      return safeEdit(interaction, `Eroare: ${errorDetail(error)}`);
    }
  }

  async function showVideos(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const selectedChannelId = interaction.options.getString("canal", true);
    const force = interaction.options.getBoolean("repeta") === true;
    const settings = await getGuildSettings(guildId);
    if (!selectedChannelId || !settings?.youtubeChannels?.length) {
      return safeEdit(interaction, "Eroare: serverul nu are canale YouTube urmarite.");
    }
    if (selectedChannelId !== "toate" && !settings.youtubeChannels.some(channel => channel.channelId === selectedChannelId)) {
      return safeEdit(interaction, "Eroare: alege un canal YouTube urmarit sau valoarea `toate`.");
    }
    if (!interaction.client) return safeEdit(interaction, "Eroare: clientul Discord nu este disponibil.");
    const client = interaction.client;
    const prepared = await prepareManualYouTubeVideos(settings, selectedChannelId, force);
    if (!prepared.length) {
      return safeEdit(interaction, force
        ? "Info: nu exista videoclipuri recente (din ultima luna) de afisat pentru aceasta selectie."
        : "Info: nu exista videoclipuri recente noi de afisat (cele din ultima luna au fost deja postate manual). Foloseste `repeta:true` ca sa le repostezi pe toate.");
    }
    const deliverable = prepared.filter(item => youtubeDestinationIds(settings, item.channel.channelId).length > 0);
    const skipped = prepared.length - deliverable.length;
    if (!deliverable.length) {
      return safeEdit(interaction, "Eroare: niciun canal de destinatie configurat pentru aceste videoclipuri. Seteaza un canal cu `/youtube notify channel` sau adauga o ruta cu `/youtube channel-route add` inainte de afisarea manuala.");
    }
    const skippedNote = skipped > 0 ? ` (${skipped} sarite: canalul lor YouTube nu are nici ruta, nici canal principal de destinatie)` : "";
    const immediate = deliverable.slice(0, YOUTUBE_MANUAL_IMMEDIATE_BATCH);
    const remaining = deliverable.slice(YOUTUBE_MANUAL_IMMEDIATE_BATCH);
    const firstResult = await deliverManualYouTubeVideos(client, settings, immediate, true, !force);
    if (!remaining.length) {
      return safeEdit(interaction, `OK: am postat ${firstResult.videos} videoclip(e) pe ${firstResult.destinations} canal(e)${skippedNote}.`);
    }
    const durable = deps.outboxEnabled === true;
    const restNote = durable
      ? `Restul de ${remaining.length} sunt programate prin outbox-ul durabil si livrate in loturi de cate ${YOUTUBE_MANUAL_IMMEDIATE_BATCH} la interval de 10 minute, ca sa supravietuiasca unui restart.`
      : `Restul de ${remaining.length} continua in fundal in loturi de cate ${YOUTUBE_MANUAL_IMMEDIATE_BATCH} la interval de 10 minute; outbox-ul e dezactivat (NOTIFICATION_OUTBOX_ENABLED=false), deci NU sunt durabile la restart - reia comanda daca botul reporneste.`;
    await safeEdit(interaction, `OK: am postat imediat primele ${firstResult.videos} videoclip(e)${skippedNote}. ${restNote}`);
    void deliverManualYouTubeVideos(client, settings, remaining, !durable, !force)
      .then(result => deps.logger(
        "INFO",
        "YOUTUBE_COMMAND",
        `Afisarea manuala YouTube (loturi suplimentare) pentru guild ${guildId}: ${result.videos} videoclipuri, ${result.batches} loturi, ${result.destinations} destinatii`
      ))
      .catch(error => deps.logger(
        "WARN",
        "YOUTUBE_COMMAND",
        `Afisarea manuala YouTube a esuat in fundal pentru guild ${guildId}`,
        errorDetail(error)
      ));
    return undefined;
  }

  async function errors(guildId: string): Promise<InteractionPayload> {
    const entries = (await getGuildSettings(guildId))?.youtubeErrors || [];
    if (!entries.length) return safeEditPlaceholder("Nu exista erori YouTube inregistrate.");
    const lines = entries.slice(-10).reverse().map(entry =>
      `- ${formatTime(entry.at)} - **${entry.channelName || entry.channelId || "YouTube"}**: ${entry.message}`
    );
    const header = "Ultimele erori YouTube:\n";
    return safeEditPlaceholder(`${header}${clampJoinedList(lines, 2000 - header.length)}`);
  }

  function safeEditPlaceholder(content: string): InteractionPayload {
    return { content };
  }

  async function permissions(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    const channelIds = new Set<string>();
    if (settings?.youtubeNotificationChannelId) channelIds.add(settings.youtubeNotificationChannelId);
    for (const route of settings?.youtubeChannelRoutes || []) {
      for (const id of route.discordChannelIds || []) {
        if (id) channelIds.add(id);
      }
    }
    if (!channelIds.size) {
      return safeEdit(interaction, "Canalul Discord pentru YouTube nu este configurat (nici canal principal cu `/youtube notify channel`, nici rute cu `/youtube channel-route add`).");
    }
    const lines: string[] = ["Permisiuni YouTube (canal principal + rute speciale):"];
    for (const id of channelIds) {
      const resolved = await checkChannelPermissions(interaction, id);
      if (!resolved) {
        lines.push(`- <#${id}>: nu am putut verifica (canal inaccesibil sau sters?)`);
        continue;
      }
      lines.push(`- <#${id}>: Send Messages ${onOff(resolved.sendMessages)} | Embed Links ${onOff(resolved.embedLinks)} | Read Message History ${onOff(resolved.readMessageHistory)}`);
    }
    return safeEdit(interaction, clampJoinedList(lines, 2000));
  }

  async function handleYouTubeInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    if (group === "notify") return notify(interaction, guildId, subcommand);
    if (group === "filter") return filter(interaction, guildId, subcommand);
    if (group === "message-template") return messageTemplate(interaction, guildId, subcommand);
    if (group === "channel-route") return channelRoute(interaction, guildId, subcommand);
    if (group === "title-filter") return titleFilter(interaction, guildId, subcommand);
    if (group === "videos" && subcommand === "show") return showVideos(interaction, guildId);
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
  const handlers = createYouTubeInteractionHandler(
    Object.assign(target, { outboxEnabled: target.env?.NOTIFICATION_OUTBOX_ENABLED === true })
  );
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
