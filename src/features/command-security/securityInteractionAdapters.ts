"use strict";

import { PermissionFlagsBits } from "discord.js";

import { readLockedChannelPermissionState } from "./channelLockRecoveryRuntime.js";
import { isSecuritySetSubcommand, SET_CHANNEL_FIELDS, START_STOP_TOGGLE_FIELDS } from "./securityCommandFields.js";

import type { LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";
import { accountAgeLabel, isRecentAccount } from "./recentAccountPolicy.js";
import { deliverNewAccountAlert } from "./newAccountAlertDedup.js";

import type {
  AccountAlertClaimFn,
  OverwriteEditor,
  SecurityChannel,
  SecurityInteraction,
  SecurityLogger
} from "./securityInteractionContracts.js";

export function botChannelPermissions(channel: SecurityChannel, guild: SecurityInteraction["guild"]): { has(flag: bigint): boolean } | null {
  const me = guild?.members?.me;
  if (!me || typeof channel.permissionsFor !== "function") return null;
  return channel.permissionsFor(me) ?? null;
}

export function missingChannelPermissions(perms: { has(flag: bigint): boolean }, required: Array<{ flag: bigint; label: string }>): string[] {
  return required.filter(entry => perms.has(entry.flag) !== true).map(entry => entry.label);
}

export function isSecurityInteraction(interaction: SecurityInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  if (interaction.commandName === "lock-channel" || interaction.commandName === "unlock-channel" || interaction.commandName === "purge" || interaction.commandName === "purge-amount") return true;
  if (interaction.commandName === "set") return isSecuritySetSubcommand(interaction.options.getSubcommand());
  if (interaction.commandName === "start" || interaction.commandName === "stop") {
    return START_STOP_TOGGLE_FIELDS[interaction.options.getSubcommand()] !== undefined;
  }
  return false;
}

export function resultSize(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object" && "size" in result && typeof result.size === "number") return result.size;
  return 0;
}

export function permissionState(channel: SecurityChannel, everyoneId: string): LockedChannelPermissionState {
  return readLockedChannelPermissionState(channel, everyoneId);
}

export function permissionValue(state: LockedChannelPermissionState): boolean | null {
  return state === "allow" ? true : state === "deny" ? false : null;
}

const OVERWRITE_REVERT_ATTEMPTS = 2;

export async function revertOverwriteWithRetry(
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

export async function sendExistingAccountAlerts(
  interaction: SecurityInteraction,
  channel: SecurityChannel,
  guildId: string,
  claim?: AccountAlertClaimFn,
  logger?: SecurityLogger
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


export function channelBulkDelete(channel: SecurityChannel | null | undefined): channel is SecurityChannel & { bulkDelete: (amount: number, filterOld?: boolean) => Promise<unknown> } {
  return Boolean(channel && typeof channel.bulkDelete === "function");
}

export async function backfillAccountAlerts(
  interaction: SecurityInteraction,
  channelId: string | null | undefined,
  guildId: string,
  claim: AccountAlertClaimFn | undefined,
  logger: SecurityLogger | undefined
): Promise<{ delivered: number; sentUnconfirmed: number; undetermined: number }> {
  const fetched = channelId && interaction.guild?.channels?.fetch
    ? await interaction.guild.channels.fetch(channelId)
    : null;
  return fetched
    ? sendExistingAccountAlerts(interaction, fetched, guildId, claim, logger)
    : { delivered: 0, sentUnconfirmed: 0, undetermined: 0 };
}

