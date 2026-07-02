"use strict";

import type { DiscordInteraction, InteractionPayload, YouTubeInteractionDeps } from "./youtubeCommandTypes";
import { clampJoinedList } from "../../command-presentation/discordListLimit";
import { formatTime, onOff } from "./youtubePresentation";

export function createYouTubeDiagnosticsCommands(deps: YouTubeInteractionDeps) {
  const { getGuildSettings, checkChannelPermissions, safeEdit } = deps;

  async function errors(guildId: string): Promise<InteractionPayload> {
    const entries = (await getGuildSettings(guildId))?.youtubeErrors || [];
    if (!entries.length) return { content: "Nu exista erori YouTube inregistrate." };
    const lines = entries.slice(-10).reverse().map(entry =>
      `- ${formatTime(entry.at)} - **${entry.channelName || entry.channelId || "YouTube"}**: ${entry.message}`
    );
    const header = "Ultimele erori YouTube:\n";
    return { content: `${header}${clampJoinedList(lines, 2000 - header.length)}` };
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
      return safeEdit(interaction, "Canalul Discord pentru YouTube nu este configurat (nici canal principal cu `/youtube notify channel`, nici rute cu `/youtube add channel-route`).");
    }
    const lines: string[] = ["Permisiuni YouTube (canal principal + rute speciale):"];
    for (const id of channelIds) {
      const resolved = await checkChannelPermissions(interaction, id);
      if (!resolved) {
        lines.push(`- <#${id}>: nu am putut verifica (canal inaccesibil sau sters?)`);
        continue;
      }
      lines.push(`- <#${id}>: View Channel ${onOff(resolved.viewChannel)} | Send Messages ${onOff(resolved.sendMessages)} | Embed Links ${onOff(resolved.embedLinks)} | Read Message History ${onOff(resolved.readMessageHistory)}`);
    }
    return safeEdit(interaction, clampJoinedList(lines, 2000));
  }

  return { errors, permissions };
}
