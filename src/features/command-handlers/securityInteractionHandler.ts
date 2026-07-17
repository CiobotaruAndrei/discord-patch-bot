"use strict";

import type { CommandHandler } from "../command-registry/commandHandler.js";
import { errorDetail } from "../../shared/errors.js";
import {
  applyGuildConfigUpdate,
  setLockedChannelPermissionState,
  type GuildConfigWriteModelLike,
  type LockedChannelPermissionState
} from "../guild-config/guildConfigRepository.js";
import { accountAgeLabel, isRecentAccount } from "../command-security/recentAccountPolicy.js";
import { validateModerationText, type DirectAttachment } from "../moderation/moderationInputPolicy.js";

type SecurityOptions = {
  getSubcommand(): string;
  getInteger(name: string, required?: boolean): number | null;
  getString(name: string, required?: boolean): string | null;
  getChannel(name: string, required?: boolean): SecurityChannel | null;
  getAttachment?(name: string, required?: boolean): DirectAttachment | null;
};

type SecurityChannel = {
  id?: string;
  send?: (payload: unknown) => Promise<unknown>;
  permissionOverwrites?: {
    cache?: { get(targetId: string): { allow?: { has(permission: string): boolean }; deny?: { has(permission: string): boolean } } | undefined };
    edit(target: object, permissions: Record<string, boolean | null>): Promise<unknown>;
  };
  bulkDelete?: (amount: number, filterOld?: boolean) => Promise<unknown>;
};

type SecurityMember = {
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null;
  joinedTimestamp?: number;
};
type SecurityMemberCollection = { values(): IterableIterator<SecurityMember> };
type SecurityInteraction = {
  commandName?: string;
  guild?: {
    id?: string;
    roles?: { everyone?: { id: string } };
    members?: { me?: object; fetch(): Promise<SecurityMemberCollection> };
    channels?: {
      cache?: { get(channelId: string): SecurityChannel | undefined };
      fetch(channelId: string): Promise<SecurityChannel | null>;
    };
  } | null;
  channel?: SecurityChannel | null;
  options: SecurityOptions;
  user?: { id?: string } | null;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
};

type GuildModelLike = GuildConfigWriteModelLike;

type GuildSettingsLike = {
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  threatAutoDeleteRiskyFiles?: boolean;
  threatAutoDeletePolicyViolations?: boolean;
  botAddAlertChannelId?: string | null;
  botAddProtectionEnabled?: boolean;
  purgeAmount?: number;
  lockedChannelIds?: string[];
  lockedChannelPermissions?: Array<{ channelId: string; sendMessages: LockedChannelPermissionState }>;
} | null;

type SecurityDeps = {
  GuildModel: GuildModelLike;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike>;
  safeDefer: (interaction: SecurityInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: SecurityInteraction, payload: unknown) => Promise<unknown>;
  checkChannelPermissions: (interaction: SecurityInteraction, channelId: string) => Promise<{
    viewChannel: boolean;
    sendMessages: boolean;
    embedLinks: boolean;
  } | null>;
  formatUserError: (err: unknown, fallback: string) => string;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
};

const SET_CHANNEL_FIELDS: Record<string, string> = {
  "new-account-alert-channel": "newAccountAlertChannelId",
  "threat-alert-channel": "threatAlertChannelId",
  "bot-add-alert-channel": "botAddAlertChannelId",
  "warn-channel": "warningChannelId"
};

type ProtectionChannelField = "newAccountAlertChannelId" | "threatAlertChannelId" | "botAddAlertChannelId";
type ProtectionEnabledField = "newAccountAlertsEnabled" | "threatProtectionEnabled" | "botAddProtectionEnabled" | "threatAutoDeleteRiskyFiles" | "threatAutoDeletePolicyViolations";

const START_STOP_TOGGLE_FIELDS: Record<string, { channel: ProtectionChannelField; enabled: ProtectionEnabledField }> = {
  "new-account-alerts": { channel: "newAccountAlertChannelId", enabled: "newAccountAlertsEnabled" },
  "threat-protection": { channel: "threatAlertChannelId", enabled: "threatProtectionEnabled" },
  "bot-add-protection": { channel: "botAddAlertChannelId", enabled: "botAddProtectionEnabled" },
  "threat-delete-risky-files": { channel: "threatAlertChannelId", enabled: "threatAutoDeleteRiskyFiles" },
  "threat-delete-policy-violations": { channel: "threatAlertChannelId", enabled: "threatAutoDeletePolicyViolations" }
};

function isSecurityInteraction(interaction: SecurityInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  if (interaction.commandName === "lock-channel" || interaction.commandName === "unlock-channel" || interaction.commandName === "purge" || interaction.commandName === "purge-amount") return true;
  if (interaction.commandName === "set") return SET_CHANNEL_FIELDS[interaction.options.getSubcommand()] !== undefined;
  if (interaction.commandName === "start" || interaction.commandName === "stop") {
    return START_STOP_TOGGLE_FIELDS[interaction.options.getSubcommand()] !== undefined;
  }
  return false;
}

function resultSize(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object" && "size" in result && typeof result.size === "number") return result.size;
  return 0;
}

function permissionState(channel: SecurityChannel, everyoneId: string): LockedChannelPermissionState {
  const overwrite = channel.permissionOverwrites?.cache?.get(everyoneId);
  if (overwrite?.allow?.has("SendMessages")) return "allow";
  if (overwrite?.deny?.has("SendMessages")) return "deny";
  return "inherit";
}

function permissionValue(state: LockedChannelPermissionState): boolean | null {
  return state === "allow" ? true : state === "deny" ? false : null;
}

async function sendExistingAccountAlerts(interaction: SecurityInteraction, channel: SecurityChannel): Promise<number> {
  const members = await interaction.guild?.members?.fetch();
  if (!members || !channel.send) return 0;
  const now = new Date();
  let sent = 0;
  for (const member of members.values()) {
    const user = member.user;
    if (!user?.id || user.bot || !isRecentAccount(user.createdTimestamp, now)) continue;
    await channel.send({
      content: `:shield: Cont existent mai nou de 3 luni: <@${user.id}> (${user.tag ?? user.id}), creat acum ${accountAgeLabel(user.createdTimestamp, now.getTime())}.`,
      allowedMentions: { parse: [] }
    });
    sent++;
  }
  return sent;
}

function buildSecurityCommandHandler(target: SecurityDeps): CommandHandler<SecurityInteraction> {
  async function respond(interaction: SecurityInteraction, content: string): Promise<unknown> {
    return target.safeEdit(interaction, { content });
  }

  async function update(interaction: SecurityInteraction, field: string, value: unknown): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const guild = interaction.guild;
    try {
      await applyGuildConfigUpdate(target.GuildModel, guildId, { [field]: value });
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
      const permissions = await target.checkChannelPermissions(interaction, channel.id);
      if (!permissions?.viewChannel || !permissions.sendMessages || !permissions.embedLinks) {
        return respond(interaction, "Eroare: botul are nevoie de View Channel, Send Messages si Embed Links in canalul selectat.");
      }
      return update(interaction, field, channel.id);
    }
    if (command === "start" || command === "stop") {
      const sub = interaction.options.getSubcommand();
      const toggle = START_STOP_TOGGLE_FIELDS[sub];
      if (!toggle) return undefined;
      const settings = await target.getGuildSettings(guildId).catch(() => null);
      const channelField = toggle.channel;
      const enabledField = toggle.enabled;
      if (command === "start" && !settings?.[channelField]) return respond(interaction, "Eroare: seteaza mai intai canalul de alerta cu `/set`.");
      if (command === "start") {
        const channelId = settings?.[channelField];
        if (typeof channelId !== "string") return respond(interaction, "Eroare: canalul de alerta nu este configurat.");
        const permissions = await target.checkChannelPermissions(interaction, channelId);
        if (!permissions?.viewChannel || !permissions.sendMessages || !permissions.embedLinks) {
          return respond(interaction, "Eroare: canalul configurat nu mai are permisiunile View Channel, Send Messages si Embed Links.");
        }
      }
      await applyGuildConfigUpdate(target.GuildModel, guildId, { [enabledField]: command === "start" });
      if (command === "start" && sub === "new-account-alerts" && settings?.newAccountAlertsEnabled !== true) {
        try {
          const channelId = settings?.newAccountAlertChannelId;
          const fetched = channelId && interaction.guild?.channels?.fetch
            ? await interaction.guild.channels.fetch(channelId)
            : null;
          const count = fetched ? await sendExistingAccountAlerts(interaction, fetched) : 0;
          return respond(interaction, `OK: protectia **${sub}** a fost pornita. Au fost verificate conturile existente si trimise ${count} alerte.`);
        } catch (err) {
          await applyGuildConfigUpdate(target.GuildModel, guildId, { [enabledField]: false });
          throw err;
        }
      }
      return respond(interaction, `OK: protectia **${sub}** a fost ${command === "start" ? "pornita" : "oprita"}.`);
    }
    if (command === "lock-channel" || command === "unlock-channel") {
      const channel = interaction.options.getChannel("canal", false) ?? interaction.options.getChannel("channel", true);
      const everyone = guild?.roles?.everyone;
      if (!channel?.id || !channel.permissionOverwrites?.edit || !everyone) return respond(interaction, "Eroare: canalul selectat nu permite modificarea permisiunilor.");
      const currentSettings = await target.getGuildSettings(guildId).catch(() => null);
      const isLocked = currentSettings?.lockedChannelIds?.includes(channel.id) === true;
      if (command === "unlock-channel" && !isLocked) return respond(interaction, "Eroare: canalul nu este blocat de bot.");
      if (command === "lock-channel" && isLocked) return respond(interaction, "Eroare: canalul este deja blocat de bot.");
      const rawReason = command === "lock-channel" ? (interaction.options.getString("motiv", false) ?? interaction.options.getString("reason", false)) : null;
      const attachment = command === "lock-channel" ? interaction.options.getAttachment?.("atasament", false) ?? null : null;
      let reason: string | null;
      try {
        reason = validateModerationText(rawReason ?? undefined);
      } catch (err) {
        return respond(interaction, err instanceof Error ? err.message : "Eroare: motivul nu este valid.");
      }
      if (command === "lock-channel" && !reason && !attachment) return respond(interaction, "Eroare: blocarea necesita motiv text sau un atasament direct.");
      const previous = command === "lock-channel"
        ? permissionState(channel, everyone.id)
        : currentSettings?.lockedChannelPermissions?.find(item => item.channelId === channel.id)?.sendMessages;
      if (!previous) return respond(interaction, "Eroare: starea anterioara a permisiunii nu este disponibila.");
      const nextValue = command === "lock-channel" ? false : permissionValue(previous);
      try {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: nextValue });
        try {
          await setLockedChannelPermissionState(
            target.GuildModel,
            guildId,
            channel.id,
            previous,
            command === "lock-channel"
          );
        } catch (err) {
          await channel.permissionOverwrites.edit(everyone, {
            SendMessages: command === "lock-channel" ? permissionValue(previous) : false
          });
          throw err;
        }
        const result = command === "lock-channel" ? `OK: canalul a fost blocat${reason ? ` (motiv: ${reason})` : ""}.` : "OK: canalul a fost deblocat.";
        if (command === "lock-channel") {
          await channel.send?.({
            content: `:lock: Canal blocat de <@${interaction.user?.id ?? "administrator"}>. Motiv: ${reason ?? "atasament direct"}.`,
            files: attachment?.url ? [attachment.url] : [],
            allowedMentions: { parse: [] }
          }).catch(() => null);
        }
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
      try {
        const result = await purgeChannel.bulkDelete(amount, true);
        const deleted = resultSize(result);
        const skipped = Math.max(0, amount - deleted);
        return respond(interaction, `OK: au fost sterse ${deleted} mesaje. Discord nu permite stergerea in masa a mesajelor mai vechi de 14 zile; ${skipped} mesaje au fost omise sau nu mai existau.`);
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
