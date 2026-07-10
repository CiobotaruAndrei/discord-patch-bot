"use strict";

import type { DiscordInteraction, YouTubeInteractionDeps } from "./youtubeCommandTypes";
import {
  DEFAULT_YOUTUBE_MESSAGE_TEMPLATE,
  MAX_YOUTUBE_ROUTE_DESTINATIONS,
  parseDiscordChannelReference,
  validateYouTubeMessageTemplate
} from "../../youtube/youtubeDeliveryPolicy";
import {
  addYouTubeRouteDestination,
  removeYouTubeChannelRoute,
  removeYouTubeRouteDestination,
  setYouTubeMessageTemplate,
  setYouTubeNotificationChannel,
  setYouTubeNotificationsEnabled
} from "../../youtube/youtubeGuildConfigRepository";
import { formatYouTubeRoutes, formatYouTubeStatus } from "./youtubePresentation";
import { countYoutubeErrors } from "../../youtube/youtubeErrorsRepository";

const { errorDetail } = require("../../../shared/errors") as typeof import("../../../shared/errors");

export function createYouTubeNotifyCommands(deps: YouTubeInteractionDeps) {
  const { GuildModel, GuildYoutubeErrorModel, getGuildSettings, invalidateGuildCache, checkChannelPermissions, safeEdit } = deps;

  async function notify(interaction: DiscordInteraction, guildId: string, subcommand: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    if (subcommand === "channel") {
      const channel = interaction.options.getChannel("channel", true);
      if (!channel?.id) return safeEdit(interaction, "Eroare: trebuie sa alegi un canal Discord valid.");
      const permissions = await checkChannelPermissions(interaction, channel.id);
      if (!permissions) return safeEdit(interaction, "Eroare: nu am putut verifica permisiunile botului pe canal.");
      const missing = [
        !permissions.viewChannel ? "View Channel" : "",
        !permissions.sendMessages ? "Send Messages" : "",
        !permissions.embedLinks ? "Embed Links" : ""
      ].filter(Boolean);
      if (missing.length) {
        return safeEdit(interaction, `Eroare: botului ii lipsesc permisiunile ${missing.join(", ")} pe <#${channel.id}>.`);
      }
      await setYouTubeNotificationChannel(GuildModel, guildId, channel.id);
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
      await setYouTubeNotificationsEnabled(GuildModel, guildId, true);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: notificarile YouTube sunt active in <#${settings.youtubeNotificationChannelId}>.`);
    }
    if (subcommand === "off") {
      await setYouTubeNotificationsEnabled(GuildModel, guildId, false);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: notificarile YouTube sunt oprite. Canalele urmarite raman salvate.");
    }
    return safeEdit(interaction, formatYouTubeStatus(settings, await countYoutubeErrors(GuildYoutubeErrorModel, guildId)));
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
      await setYouTubeMessageTemplate(GuildModel, guildId, null);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: sablonul YouTube a revenit la valoarea implicita:\n\`${DEFAULT_YOUTUBE_MESSAGE_TEMPLATE}\``);
    }
    const rawTemplate = interaction.options.getString("text", true);
    if (!rawTemplate) return safeEdit(interaction, "Eroare: trebuie sa introduci textul sablonului.");
    try {
      const template = validateYouTubeMessageTemplate(rawTemplate);
      await setYouTubeMessageTemplate(GuildModel, guildId, template);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: sablonul mesajului YouTube a fost actualizat.");
    } catch (error) {
      return safeEdit(interaction, `Eroare: ${errorDetail(error)}`);
    }
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
      if (!permissions?.viewChannel || !permissions.sendMessages || !permissions.embedLinks) {
        return safeEdit(interaction, "Eroare: botul are nevoie de View Channel, Send Messages si Embed Links pe canalul ales.");
      }
      const currentDestinations = existingRoute?.discordChannelIds || [];
      if (!currentDestinations.includes(discordChannel.id) && currentDestinations.length >= MAX_YOUTUBE_ROUTE_DESTINATIONS) {
        return safeEdit(interaction, `Eroare: ai atins limita de ${MAX_YOUTUBE_ROUTE_DESTINATIONS} canale Discord pentru ruta lui **${subscription.channelName}**. Scoate o destinatie cu \`/youtube remove channel-route\` inainte sa adaugi alta.`);
      }
      const outcome = await addYouTubeRouteDestination(GuildModel, guildId, youtubeChannelId, discordChannel.id);
      invalidateGuildCache(guildId);
      if (!outcome.saved) {
        return safeEdit(interaction, `Eroare: ai atins limita de ${MAX_YOUTUBE_ROUTE_DESTINATIONS} canale Discord pentru ruta lui **${subscription.channelName}** (o comanda concurenta a ocupat ultimul loc). Scoate o destinatie cu \`/youtube remove channel-route\` inainte sa adaugi alta.`);
      }
      return safeEdit(interaction, `OK: videoclipurile de la **${subscription.channelName}** vor fi trimise exclusiv in rutele speciale configurate, inclusiv <#${discordChannel.id}>.`);
    }
    const requested = interaction.options.getString("discord", true);
    if (!requested) return safeEdit(interaction, "Eroare: alege canalul Discord sau valoarea `toate`.");
    if (!existingRoute) return safeEdit(interaction, "Info: canalul YouTube nu are rute speciale configurate.");
    if (requested === "toate") {
      await removeYouTubeChannelRoute(GuildModel, guildId, youtubeChannelId);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: toate rutele speciale pentru **${subscription.channelName}** au fost sterse. Se foloseste din nou canalul principal.`);
    }
    const discordChannelId = parseDiscordChannelReference(requested);
    if (!discordChannelId || !existingRoute.discordChannelIds.includes(discordChannelId)) {
      return safeEdit(interaction, "Eroare: ruta Discord aleasa nu exista pentru acest canal YouTube.");
    }
    if (existingRoute.discordChannelIds.length === 1) {
      await removeYouTubeChannelRoute(GuildModel, guildId, youtubeChannelId);
    } else {
      await removeYouTubeRouteDestination(GuildModel, guildId, youtubeChannelId, discordChannelId);
    }
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: ruta <#${discordChannelId}> a fost stearsa pentru **${subscription.channelName}**.`);
  }

  return { notify, messageTemplate, channelRoute };
}
