"use strict";

import { PermissionFlagsBits } from "discord.js";

import type { SecurityInteraction } from "./securityInteractionContracts.js";

export function antiRaidReadiness(interaction: Pick<SecurityInteraction, "guild">): string[] {
  const me = interaction.guild?.members?.me;
  const missing: string[] = [];
  if (me?.permissions?.has(PermissionFlagsBits.ViewAuditLog) !== true) missing.push("View Audit Log");
  if (me?.permissions?.has(PermissionFlagsBits.ModerateMembers) !== true) missing.push("Moderate Members");
  if (me?.permissions?.has(PermissionFlagsBits.MuteMembers) !== true) missing.push("Mute Members");
  if (me?.permissions?.has(PermissionFlagsBits.BanMembers) !== true) missing.push("Ban Members");
  if (me?.permissions?.has(PermissionFlagsBits.ManageChannels) !== true) missing.push("Manage Channels");
  if (me?.permissions?.has(PermissionFlagsBits.ManageRoles) !== true) missing.push("Manage Roles");
  if ((me?.roles?.highest?.position ?? 0) <= 0) missing.push("rol pozitionat deasupra rolului @everyone (necesar pentru sanctiuni si lockdown)");
  return missing;
}

export interface ProtectionToggleGate {
  ownerOnly: boolean;
  isOwner: boolean;
  confirmed: boolean;
  needsReadinessCheck: boolean;
  readinessGaps: () => string[];
}

export function protectionToggleGate(interaction: SecurityInteraction, subcommand: string): ProtectionToggleGate {
  const ownerId = interaction.guild?.ownerId;
  return {
    ownerOnly: subcommand === "anti-raid",
    isOwner: ownerId !== undefined && ownerId === interaction.user?.id,
    confirmed: interaction.options.getBoolean?.("confirm", false) === true,
    needsReadinessCheck: subcommand === "moderation-guard" || subcommand === "anti-raid",
    readinessGaps: () => (subcommand === "anti-raid" ? antiRaidReadiness(interaction) : botRemovalReadiness(interaction))
  };
}

export function botRemovalReadiness(interaction: Pick<SecurityInteraction, "guild">): string[] {
  const me = interaction.guild?.members?.me;
  const missing: string[] = [];
  if (me?.permissions?.has(PermissionFlagsBits.ViewAuditLog) !== true) missing.push("View Audit Log");
  if (me?.permissions?.has(PermissionFlagsBits.KickMembers) !== true) missing.push("Kick Members");
  if ((me?.roles?.highest?.position ?? 0) <= 0) missing.push("rol pozitionat deasupra rolului @everyone (necesar pentru a elimina boti)");
  return missing;
}
