"use strict";

import type { CurrencyCode, DiscordReplyPayload, GameConfig } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { buildResetConfiguration } from "../guild-config/guildConfigDefaults.js";
import { resetGuildConfigurationWithAudit, setAdminAlertChannel } from "../guild-config/guildConfigRepository.js";
import type { GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import type { YoutubeErrorModelLike } from "../youtube/youtubeErrorsRepository.js";
import type { DeadLetterModelLike } from "../notifications/deadLetterRepository.js";

import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail } from "../../shared/errors.js";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordChannel {
  id: string;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id?: string } | null;
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
  viewChannel: boolean;
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
    ): Promise<{ matchedCount?: number; modifiedCount?: number }>;
  };
  GuildAuditLogModel: GuildAuditLogModelLike;
  GuildYoutubeErrorModel: Pick<YoutubeErrorModelLike, "deleteMany">;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "deleteMany">;
  deleteAllReplayPayloads(guildId: string): Promise<void>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  checkChannelPermissions(interaction: DiscordInteraction, channelId: string): Promise<ChannelPermissions | null>;
  DEFAULT_CURRENCY: CurrencyCode;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type GuildConfigurationAdminContext = GuildConfigurationAdminDeps;

function createGuildConfigurationAdminHandler(deps: GuildConfigurationAdminDeps) {
  const {
    GuildModel, GuildAuditLogModel, GuildYoutubeErrorModel, GuildDeadLetterModel, deleteAllReplayPayloads, safeDefer, safeEdit,
    checkChannelPermissions, DEFAULT_CURRENCY, logger
  } = deps;

  async function handleResetConfiguration(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (interaction.options.getBoolean("confirm", true) !== true) {
      return safeEdit(interaction, "Resetarea a fost anulata. Foloseste `confirm:true` numai daca vrei sa stergi toate setarile serverului.");
    }
    await resetGuildConfigurationWithAudit(GuildModel, GuildAuditLogModel, GuildYoutubeErrorModel, GuildDeadLetterModel, guildId, DEFAULT_CURRENCY, {
      userId: interaction.user?.id || "",
      action: "reset_config",
      details: "Configuratia serverului a fost resetata la valorile implicite"
    });
    let replayCleanupOk = true;
    try {
      await deleteAllReplayPayloads(guildId);
    } catch (err: unknown) {
      replayCleanupOk = false;
      logger("WARN", "GUILD_CONFIG_ADMIN", `Reset config: stergerea payload-urilor de replay a esuat pentru guild ${guildId}`, errorDetail(err));
    }
    return safeEdit(interaction, replayCleanupOk
      ? "OK: configuratia serverului a fost resetata la valorile implicite. Lista dead-letter si payload-urile de replay au fost sterse; istoricul rapoartelor si al notificarilor livrate nu a fost sters."
      : "Partial: configuratia serverului a fost resetata si lista dead-letter golita, dar stergerea payload-urilor de replay a esuat. Verifica MongoDB si jurnalele operationale; istoricul notificarilor livrate nu a fost sters.");
  }

  async function handleAdminAlerts(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "off") {
      await setAdminAlertChannel(GuildModel, guildId, null);
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
      !permissions.viewChannel ? "View Channel" : "",
      !permissions.sendMessages ? "Send Messages" : "",
      !permissions.embedLinks ? "Embed Links" : ""
    ].filter(Boolean);
    if (missing.length) {
      return safeEdit(interaction, `Eroare: botului ii lipsesc permisiunile ${missing.join(", ")} pe <#${channel.id}>.`);
    }
    await setAdminAlertChannel(GuildModel, guildId, channel.id);
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
  return matchesCommand(interaction, { commandNames: ["reset-config", "admin-alerts"] });
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
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createGuildConfigurationAdminHandler,
  buildResetConfiguration,
  buildCommandHandler: buildGuildConfigurationAdminCommandHandler
};
