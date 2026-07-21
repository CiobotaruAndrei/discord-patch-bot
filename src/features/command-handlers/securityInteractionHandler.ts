"use strict";

import { PermissionFlagsBits } from "discord.js";
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
import { countActiveBotAddPermissions, stopBotAddProtectionAtomically } from "../moderation/botAddRepository.js";
import { createNewAccountAlertDelivery, deliverNewAccountAlert, type NewAccountAlertClaim, type NewAccountAlertDeliveryModelLike } from "../command-security/newAccountAlertDedup.js";
import { randomUUID } from "node:crypto";

type AccountAlertClaimFn = (guildId: string, userId: string) => Promise<NewAccountAlertClaim | null>;

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
  permissionsFor?: (member: object) => { has(flag: bigint): boolean } | null | undefined;
  bulkDelete?: (amount: number, filterOld?: boolean) => Promise<unknown>;
};

type SecurityMember = {
  user?: { id?: string; tag?: string; bot?: boolean; createdTimestamp?: number } | null;
  joinedTimestamp?: number;
};
type SecurityMemberCollection = { values(): IterableIterator<SecurityMember> };
type BotGuildMember = {
  permissions?: { has(flag: bigint): boolean } | null;
  roles?: { highest?: { position?: number } | null } | null;
};
type SecurityInteraction = {
  commandName?: string;
  guild?: {
    id?: string;
    roles?: { everyone?: { id: string } };
    members?: { me?: (object & BotGuildMember) | null; fetch(): Promise<SecurityMemberCollection> };
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
  botAddAlertChannelId?: string | null;
  botAddProtectionEnabled?: boolean;
  botAddPermissions?: unknown;
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
  NewAccountAlertDeliveryModel?: NewAccountAlertDeliveryModelLike;
};

const SET_CHANNEL_FIELDS: Record<string, string> = {
  "new-account-alert-channel": "newAccountAlertChannelId",
  "threat-alert-channel": "threatAlertChannelId",
  "bot-add-alert-channel": "botAddAlertChannelId",
  "warn-channel": "warningChannelId"
};

type ProtectionChannelField = "newAccountAlertChannelId" | "threatAlertChannelId" | "botAddAlertChannelId";
type ProtectionEnabledField = "newAccountAlertsEnabled" | "threatProtectionEnabled" | "botAddProtectionEnabled";

const START_STOP_TOGGLE_FIELDS: Record<string, { channel: ProtectionChannelField; enabled: ProtectionEnabledField }> = {
  "new-account-alerts": { channel: "newAccountAlertChannelId", enabled: "newAccountAlertsEnabled" },
  "threat-protection": { channel: "threatAlertChannelId", enabled: "threatProtectionEnabled" },
  "bot-add-protection": { channel: "botAddAlertChannelId", enabled: "botAddProtectionEnabled" }
};

function botChannelPermissions(channel: SecurityChannel, guild: SecurityInteraction["guild"]): { has(flag: bigint): boolean } | null {
  const me = guild?.members?.me;
  if (!me || typeof channel.permissionsFor !== "function") return null;
  return channel.permissionsFor(me) ?? null;
}

function missingChannelPermissions(perms: { has(flag: bigint): boolean }, required: Array<{ flag: bigint; label: string }>): string[] {
  return required.filter(entry => perms.has(entry.flag) !== true).map(entry => entry.label);
}

function botAddProtectionReadiness(interaction: SecurityInteraction): string[] {
  const me = interaction.guild?.members?.me;
  const missing: string[] = [];
  if (me?.permissions?.has(PermissionFlagsBits.ViewAuditLog) !== true) missing.push("View Audit Log");
  if (me?.permissions?.has(PermissionFlagsBits.KickMembers) !== true) missing.push("Kick Members");
  if ((me?.roles?.highest?.position ?? 0) <= 0) missing.push("rol pozitionat deasupra rolului @everyone (necesar pentru a elimina boti)");
  return missing;
}

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

type OverwriteEditor = (target: object, permissions: Record<string, boolean | null>) => Promise<unknown>;

const OVERWRITE_REVERT_ATTEMPTS = 2;

async function revertOverwriteWithRetry(
  edit: OverwriteEditor,
  everyone: object,
  value: boolean | null,
  attempts: number = OVERWRITE_REVERT_ATTEMPTS
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await edit(everyone, { SendMessages: value });
      return true;
    } catch {
      if (attempt === attempts) return false;
    }
  }
  return false;
}

async function sendExistingAccountAlerts(
  interaction: SecurityInteraction,
  channel: SecurityChannel,
  guildId: string,
  claim?: AccountAlertClaimFn,
  logger?: SecurityDeps["logger"]
): Promise<{ delivered: number; sentUnconfirmed: number; undetermined: number }> {
  const members = await interaction.guild?.members?.fetch();
  const send = channel.send;
  if (!members || !send) return { delivered: 0, sentUnconfirmed: 0, undetermined: 0 };
  const now = new Date();
  let delivered = 0;
  let sentUnconfirmed = 0;
  let undetermined = 0;
  for (const member of members.values()) {
    const user = member.user;
    if (!user?.id || user.bot || !isRecentAccount(user.createdTimestamp, now)) continue;
    const ticket = claim ? await claim(guildId, user.id) : null;
    if (claim && !ticket) continue;
    const outcome = await deliverNewAccountAlert(ticket, async () => {
      await send({
        content: `:shield: Cont existent mai nou de 3 luni: <@${user.id}> (${user.tag ?? user.id}), creat acum ${accountAgeLabel(user.createdTimestamp, now.getTime())}.`,
        allowedMentions: { parse: [] }
      });
    });
    if (outcome === "delivered") delivered++;
    else if (outcome === "sent-unconfirmed") {
      sentUnconfirmed++;
      logger?.("WARN", "NEW_ACCOUNT_ALERT", "Alerta cont nou trimisa dar nefinalizata in Mongo (sent-unconfirmed); nu se retrimite, necesita reconciliere", { guildId, userId: user.id });
    } else if (outcome === "undetermined") {
      undetermined++;
      logger?.("ERROR", "NEW_ACCOUNT_ALERT", "Alerta cont nou trimisa, dar starea nu a putut fi persistata deloc (nedeterminata); claim-ul ramane blocat pana la reconciliere si NU se retrimite", { guildId, userId: user.id });
    }
  }
  return { delivered, sentUnconfirmed, undetermined };
}

function buildSecurityCommandHandler(target: SecurityDeps): CommandHandler<SecurityInteraction> {
  const accountAlertClaim: AccountAlertClaimFn | undefined = target.NewAccountAlertDeliveryModel
    ? createNewAccountAlertDelivery(target.NewAccountAlertDeliveryModel, () => randomUUID()).claim
    : undefined;
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
        if (sub === "bot-add-protection") {
          const missing = botAddProtectionReadiness(interaction);
          if (missing.length > 0) {
            return respond(interaction, `Eroare: protectia la adaugarea botilor nu poate porni - lipsesc: ${missing.join(", ")}. Acorda-le botului si reincearca.`);
          }
        }
      }
      if (command === "stop" && sub === "bot-add-protection") {
        const active = countActiveBotAddPermissions(settings?.botAddPermissions, new Date());
        try {
          await stopBotAddProtectionAtomically(target.GuildModel, guildId);
        } catch (err) {
          target.logger?.("WARN", "SECURITY_COMMAND", "Anularea aprobarilor bot-add active a esuat", errorDetail(err));
          return respond(interaction, "Eroare: protectia **bot-add-protection** NU a fost oprita, deoarece anularea atomica a aprobarilor active a esuat. Starea anterioara a ramas activa.");
        }
        return respond(interaction, `OK: protectia **bot-add-protection** a fost oprita. Solicitari/aprobari active anulate: ${active}.`);
      }
      await applyGuildConfigUpdate(target.GuildModel, guildId, { [enabledField]: command === "start" });
      if (command === "start" && sub === "new-account-alerts" && settings?.newAccountAlertsEnabled !== true) {
        try {
          const channelId = settings?.newAccountAlertChannelId;
          const fetched = channelId && interaction.guild?.channels?.fetch
            ? await interaction.guild.channels.fetch(channelId)
            : null;
          const result = fetched ? await sendExistingAccountAlerts(interaction, fetched, guildId, accountAlertClaim, target.logger) : { delivered: 0, sentUnconfirmed: 0, undetermined: 0 };
          const unconfirmedNote = result.sentUnconfirmed > 0
            ? ` ${result.sentUnconfirmed} au fost trimise si marcate neconfirmate in baza de date (starea protectoare e persistata, deci nu se retrimit).`
            : "";
          const undeterminedNote = result.undetermined > 0
            ? ` ${result.undetermined} au fost trimise, dar starea NU a putut fi persistata deloc (nedeterminata): claim-ul ramane blocat, nu se retrimit, si sunt reconciliate automat la urmatoarea pornire.`
            : "";
          return respond(interaction, `OK: protectia **${sub}** a fost pornita. Au fost verificate conturile existente si trimise ${result.delivered} alerte confirmate.${unconfirmedNote}${undeterminedNote}`);
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
      const overwrites = channel.permissionOverwrites;
      const editOverwrite: OverwriteEditor = (roleTarget, permissions) => overwrites.edit(roleTarget, permissions);
      const lockPerms = botChannelPermissions(channel, guild);
      if (!lockPerms) return respond(interaction, "Eroare: permisiunile efective ale botului nu pot fi verificate pentru canalul selectat.");
      const requiredPermissions = [
        { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
        { flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels" },
        { flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles (Manage Permissions)" }
      ];
      if (command === "lock-channel") requiredPermissions.push({ flag: PermissionFlagsBits.SendMessages, label: "Send Messages" });
      const missing = missingChannelPermissions(lockPerms, requiredPermissions);
      if (missing.length > 0) return respond(interaction, `Eroare: botul nu are permisiunile efective necesare in acel canal pentru blocare/deblocare: ${missing.join(", ")}. Acorda-le si reincearca.`);
      if (command === "lock-channel" && typeof channel.send !== "function") return respond(interaction, "Eroare: canalul selectat nu poate primi mesajul obligatoriu de blocare.");
      const sendLockMessage = typeof channel.send === "function" ? channel.send.bind(channel) : null;
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
        await editOverwrite(everyone, { SendMessages: nextValue });
        try {
          await setLockedChannelPermissionState(
            target.GuildModel,
            guildId,
            channel.id,
            previous,
            command === "lock-channel"
          );
        } catch (err) {
          const restoreValue = command === "lock-channel" ? permissionValue(previous) : false;
          const discordReverted = await revertOverwriteWithRetry(editOverwrite, everyone, restoreValue);
          if (discordReverted) throw err;
          target.logger?.("ERROR", "LOCK_CHANNEL", "Stare divergenta: persistarea a esuat si rollback-ul permisiunii Discord a esuat si el", { guildId, channelId: channel.id, command, previous, detail: errorDetail(err) });
          const discordStateLabel = command === "lock-channel" ? "blocat (SendMessages=deny)" : "deblocat";
          return respond(interaction, `Atentie: ${command === "lock-channel" ? "blocarea" : "deblocarea"} canalului <#${channel.id}> a modificat permisiunea in Discord, dar persistenta a esuat, iar revenirea permisiunii a esuat si dupa reincercare. Stare divergenta: Discord = ${discordStateLabel}, persistenta = NESALVATA. Restaureaza manual SendMessages la \`${previous}\` pentru acel canal.`);
        }
        const result = command === "lock-channel" ? `OK: canalul a fost blocat${reason ? ` (motiv: ${reason})` : ""}.` : "OK: canalul a fost deblocat.";
        if (command === "lock-channel") {
          try {
            if (!sendLockMessage) throw new Error("Canalul nu mai poate primi mesajul de blocare.");
            await sendLockMessage({
              content: `:lock: Canal blocat de <@${interaction.user?.id ?? "administrator"}>. Motiv: ${reason ?? "atasament direct"}.`,
              files: attachment?.url ? [attachment.url] : [],
              allowedMentions: { parse: [] }
            });
          } catch (error) {
            const mongoReverted = await setLockedChannelPermissionState(target.GuildModel, guildId, channel.id, previous, false).then(() => true).catch(() => false);
            const discordReverted = await revertOverwriteWithRetry(editOverwrite, everyone, permissionValue(previous));
            if (mongoReverted && discordReverted) throw error;
            return respond(interaction, `Atentie: blocarea a esuat la trimiterea mesajului si compensarea a fost partiala (persistenta: ${mongoReverted ? "revenita" : "ESUATA"}, permisiune Discord: ${discordReverted ? "revenita" : "ESUATA"}). Canalul necesita verificare manuala.`);
          }
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
      const purgePerms = botChannelPermissions(purgeChannel, guild);
      if (purgePerms) {
        const missing = missingChannelPermissions(purgePerms, [
          { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
          { flag: PermissionFlagsBits.ManageMessages, label: "Manage Messages" },
          { flag: PermissionFlagsBits.ReadMessageHistory, label: "Read Message History" }
        ]);
        if (missing.length > 0) return respond(interaction, `Eroare: botul nu are permisiunile efective necesare in acest canal pentru stergerea in masa: ${missing.join(", ")}. Acorda-le si reincearca.`);
      }
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
