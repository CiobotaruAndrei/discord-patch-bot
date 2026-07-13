"use strict";

import type { CommandGame, CommandHandler } from "../command-registry/commandHandler.js";
import type { DiscordInteraction, YouTubeInteractionDeps } from "./youtube/youtubeCommandTypes.js";
import { createYouTubeSubscriptionCommands } from "./youtube/youtubeSubscriptionCommands.js";
import { createYouTubeNotifyCommands } from "./youtube/youtubeNotifyCommands.js";
import { createYouTubeFilterCommands } from "./youtube/youtubeFilterCommands.js";
import { createYouTubeManualVideoCommands } from "./youtube/youtubeManualVideoCommands.js";
import { createYouTubeDiagnosticsCommands } from "./youtube/youtubeDiagnosticsCommands.js";
import { formatYouTubeList, formatYouTubeStatus } from "./youtube/youtubePresentation.js";
import { countYoutubeErrors } from "../youtube/youtubeErrorsRepository.js";

import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail } from "../../shared/errors.js";

type YouTubeContext = YouTubeInteractionDeps & {
  env?: { NOTIFICATION_OUTBOX_ENABLED?: boolean };
};

function createYouTubeInteractionHandler(deps: YouTubeInteractionDeps) {
  const { GuildYoutubeErrorModel, getGuildSettings, clearYouTubeErrors, safeDefer, safeEdit } = deps;
  const subscriptionCommands = createYouTubeSubscriptionCommands(deps);
  const notifyCommands = createYouTubeNotifyCommands(deps);
  const filterCommands = createYouTubeFilterCommands(deps);
  const manualVideoCommands = createYouTubeManualVideoCommands(deps);
  const diagnosticsCommands = createYouTubeDiagnosticsCommands(deps);

  async function handleYouTubeInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    if (group === "notify") return notifyCommands.notify(interaction, guildId, subcommand);
    if (group === "filter") return filterCommands.filter(interaction, guildId, subcommand);
    if (group === "message-template") return notifyCommands.messageTemplate(interaction, guildId, subcommand);
    if (group === "add" || group === "remove") {
      if (subcommand === "channel-route") return notifyCommands.channelRoute(interaction, guildId, group);
      if (subcommand === "title-filter") return filterCommands.titleFilter(interaction, guildId, group);
    }
    if (group === "channel-route") return notifyCommands.channelRoute(interaction, guildId, subcommand);
    if (group === "title-filter") return filterCommands.titleFilter(interaction, guildId, subcommand);
    if (group === "videos" && subcommand === "show") return manualVideoCommands.showVideos(interaction, guildId);
    if (subcommand === "subscribe") return subscriptionCommands.subscribe(interaction, guildId);
    if (subcommand === "unsubscribe") return subscriptionCommands.unsubscribe(interaction, guildId);
    if (subcommand === "list") return safeEdit(interaction, formatYouTubeList(await getGuildSettings(guildId)));
    if (subcommand === "status") return safeEdit(interaction, formatYouTubeStatus(await getGuildSettings(guildId), await countYoutubeErrors(GuildYoutubeErrorModel, guildId)));
    if (subcommand === "errors") {
      const payload = await diagnosticsCommands.errors(guildId);
      return safeEdit(interaction, payload);
    }
    if (subcommand === "permissions") return diagnosticsCommands.permissions(interaction, guildId);
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
    { ...target, outboxEnabled: target.env?.NOTIFICATION_OUTBOX_ENABLED === true }
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
        return handledCommandError(errorDetail(error));
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createYouTubeInteractionHandler,
  buildCommandHandler: buildYouTubeCommandHandler,
  formatYouTubeList,
  formatYouTubeStatus
};
