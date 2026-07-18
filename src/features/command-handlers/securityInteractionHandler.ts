"use strict";

import type { CommandHandler } from "../command-registry/commandHandler.js";
import { errorDetail } from "../../shared/errors.js";
import { createGuildSettingsRepository, type GuildSettingsRepository } from "../guild-config/guildSettingsRepository.js";
import { missingPermissionsMessage, type ChannelPermissionSnapshot } from "../command-security/permissionPolicy.js";
import type { GuildSettingsField } from "../guild-config/guildAggregate.js";

type SecurityOptions = {
  getSubcommand(): string;
  getInteger(name: string, required?: boolean): number | null;
  getString(name: string, required?: boolean): string | null;
  getChannel(name: string, required?: boolean): SecurityChannel | null;
};

type SecurityChannel = {
  id?: string;
  send?: (payload: unknown) => Promise<unknown>;
  permissionOverwrites?: { edit(target: unknown, permissions: Record<string, boolean>): Promise<unknown> };
  bulkDelete?: (amount: number, filterOld?: boolean) => Promise<unknown>;
};

type SecurityInteraction = {
  commandName?: string;
  guild?: { id?: string; roles?: { everyone?: unknown } } | null;
  channel?: SecurityChannel | null;
  options: SecurityOptions;
  user?: { id?: string } | null;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
};

type GuildModelLike = {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
};

type GuildSettingsLike = {
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  botAddAlertChannelId?: string | null;
  botAddProtectionEnabled?: boolean;
  purgeAmount?: number;
  lockedChannelIds?: string[];
} | null;

type SecurityDeps = {
  GuildModel: GuildModelLike;
  guildSettingsRepository?: GuildSettingsRepository;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike>;
  invalidateGuildCache?: (guildId: string) => void;
  safeDefer: (interaction: SecurityInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: SecurityInteraction, payload: unknown) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string) => string;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
  checkChannelPermissions?: (interaction: SecurityInteraction, channelId: string) => Promise<{ viewChannel: boolean; sendMessages: boolean; embedLinks: boolean; readMessageHistory: boolean; manageMessages?: boolean; manageChannels?: boolean } | null>;
};

const SET_CHANNEL_FIELDS: Record<string, GuildSettingsField> = {
  "new-account-alert-channel": "newAccountAlertChannelId",
  "threat-alert-channel": "threatAlertChannelId",
  "bot-add-alert-channel": "botAddAlertChannelId"
};

function isSecurityInteraction(interaction: SecurityInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  if (interaction.commandName === "lock-channel" || interaction.commandName === "unlock-channel" || interaction.commandName === "purge" || interaction.commandName === "purge-amount") return true;
  if (interaction.commandName === "set") return SET_CHANNEL_FIELDS[interaction.options.getSubcommand()] !== undefined;
  if (interaction.commandName === "start" || interaction.commandName === "stop") {
    const sub = interaction.options.getSubcommand();
    return sub === "new-account-alerts" || sub === "threat-protection" || sub === "bot-add-protection";
  }
  return false;
}

function resultSize(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object" && "size" in result && typeof result.size === "number") return result.size;
  return 0;
}

function buildSecurityCommandHandler(target: SecurityDeps): CommandHandler<SecurityInteraction> {
  const settingsRepository = target.guildSettingsRepository ?? createGuildSettingsRepository(target.GuildModel, target.invalidateGuildCache);
  async function respond(interaction: SecurityInteraction, content: string): Promise<unknown> {
    return target.safeEdit(interaction, { content });
  }

  async function update(interaction: SecurityInteraction, field: GuildSettingsField, value: unknown): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const guild = interaction.guild;
    try {
      await settingsRepository.setField(guildId, field, value);
      return respond(interaction, `OK: setarea **${field}** a fost actualizata.`);
    } catch (err: unknown) {
      target.logger?.("WARN", "SECURITY_COMMAND", "Salvarea setarii de securitate a esuat", errorDetail(err));
      return respond(interaction, target.formatUserError(err, "Eroare la salvarea setarii."));
    }
  }

  async function handle(interaction: SecurityInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const guild = interaction.guild;
    await target.safeDefer(interaction, true);
    const command = interaction.commandName;
    if (command === "set") {
      const field = SET_CHANNEL_FIELDS[interaction.options.getSubcommand()];
      const channel = interaction.options.getChannel("canal", false) ?? interaction.options.getChannel("channel", true);
      if (!field || !channel?.id) return respond(interaction, "Eroare: trebuie selectat un canal valid.");
      return update(interaction, field, channel.id);
    }
    if (command === "start" || command === "stop") {
      const sub = interaction.options.getSubcommand();
      const settings = await target.getGuildSettings(guildId).catch(() => null);
      const channelField: GuildSettingsField = sub === "new-account-alerts" ? "newAccountAlertChannelId" : sub === "threat-protection" ? "threatAlertChannelId" : "botAddAlertChannelId";
      const enabledField: GuildSettingsField = sub === "new-account-alerts" ? "newAccountAlertsEnabled" : sub === "threat-protection" ? "threatProtectionEnabled" : "botAddProtectionEnabled";
      if (command === "start" && !settings?.[channelField]) return respond(interaction, "Eroare: seteaza mai intai canalul de alerta cu `/set`.");
      return update(interaction, enabledField, command === "start");
    }
    if (command === "lock-channel" || command === "unlock-channel") {
      const channel = interaction.options.getChannel("canal", false) ?? interaction.options.getChannel("channel", true);
      const everyone = guild?.roles?.everyone;
      if (!channel?.id || !channel.permissionOverwrites?.edit || !everyone) return respond(interaction, "Eroare: canalul selectat nu permite modificarea permisiunilor.");
      const permissions = await target.checkChannelPermissions?.(interaction, channel.id);
      const lockPermissionError = missingPermissionsMessage(permissions ? {
        "Manage Channels": permissions.manageChannels,
        "Send Messages": permissions.sendMessages
      } satisfies ChannelPermissionSnapshot : null, ["Manage Channels", "Send Messages"]);
      if (lockPermissionError) return respond(interaction, lockPermissionError);
      const currentSettings = await target.getGuildSettings(guildId).catch(() => null);
      const isLocked = currentSettings?.lockedChannelIds?.includes(channel.id) === true;
      if (command === "unlock-channel" && !isLocked) return respond(interaction, "Eroare: canalul nu este blocat de bot.");
      if (command === "lock-channel" && isLocked) return respond(interaction, "Eroare: canalul este deja blocat de bot.");
      const reason = command === "lock-channel" ? (interaction.options.getString("motiv", false) ?? interaction.options.getString("reason", true)) : null;
      if (reason && /(?:https?:\/\/|www\.)/i.test(reason)) return respond(interaction, "Eroare: motivul nu poate contine linkuri.");
      try {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: command === "unlock-channel" });
        await settingsRepository.updateChannelLock(guildId, channel.id, command === "lock-channel");
        const result = command === "lock-channel" ? `OK: canalul a fost blocat${reason ? ` (motiv: ${reason})` : ""}.` : "OK: canalul a fost deblocat.";
        if (command === "lock-channel") await channel.send?.({ content: `:lock: Canal blocat de <@${interaction.user?.id ?? "administrator"}>. Motiv: ${reason ?? "nespecificat"}.`, allowedMentions: { parse: [] } }).catch(() => null);
        return respond(interaction, result);
      } catch (err: unknown) {
        return respond(interaction, target.formatUserError(err, "Eroare la modificarea permisiunilor canalului."));
      }
    }
    if (command === "purge" || command === "purge-amount") {
      const requested = interaction.options.getInteger("numar", false);
      const amount = requested ?? (command === "purge" ? 50 : 0);
      if (amount < 1 || amount > 100) return respond(interaction, "Eroare: numarul de mesaje trebuie sa fie intre 1 si 100.");
      const purgeChannel = interaction.channel;
      if (!channelBulkDelete(purgeChannel)) return respond(interaction, "Eroare: canalul curent nu permite stergerea mesajelor.");
      const permissions = await target.checkChannelPermissions?.(interaction, (purgeChannel as SecurityChannel & { id?: string })?.id ?? "");
      if (permissions) {
        const purgePermissionError = missingPermissionsMessage({
          "View Channel": permissions.viewChannel,
          "Read Message History": permissions.readMessageHistory,
          "Manage Messages": permissions.manageMessages
        }, ["View Channel", "Read Message History", "Manage Messages"]);
        if (purgePermissionError) return respond(interaction, purgePermissionError);
      }
      try {
        const result = await purgeChannel.bulkDelete(amount, true);
        return respond(interaction, `OK: au fost sterse ${resultSize(result)} mesaje.`);
      } catch (err: unknown) {
        return respond(interaction, target.formatUserError(err, "Eroare la stergerea mesajelor."));
      }
    }
    return undefined;
  }

  return {
    canHandle: (interaction: unknown): interaction is SecurityInteraction => isSecurityInteraction(interaction as SecurityInteraction),
    handle: interaction => handle(interaction)
  };
}

function channelBulkDelete(channel: SecurityChannel | null | undefined): channel is SecurityChannel & { bulkDelete: (amount: number, filterOld?: boolean) => Promise<unknown> } {
  return Boolean(channel && typeof channel.bulkDelete === "function");
}

export default { buildCommandHandler: buildSecurityCommandHandler };
