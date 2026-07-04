"use strict";

import {
  buildAdminCommandAccessScope,
  resolveAdminCommandAccessForScope,
  type AdminCommandAccessConfig
} from "./adminCommandAccessScope";
import { isOwnerOnlyCommandPath, isRouterAdminCommandPath, isSensitiveCommandPath } from "./commandAccessManifest";
import { isSensitiveUserAllowed } from "./adminAccessPolicy";
import type {
  AdminCommandGuardContext,
  AdminGuardInteraction,
  GuildAdminAccessDoc,
  GuildAdminAccessQuery,
  GuildModelLike
} from "./adminGuardContracts";

export function parseIdList(value: string | undefined): string[] {
  return String(value || "").split(",").map(id => id.trim()).filter(Boolean);
}

export function getCommandSubcommand(interaction: AdminGuardInteraction): string {
  try {
    return interaction.options?.getSubcommand?.(false) || "";
  } catch {
    return "";
  }
}

export function getCommandGroup(interaction: AdminGuardInteraction): string {
  try {
    return interaction.options?.getSubcommandGroup?.(false) || "";
  } catch {
    return "";
  }
}

export function commandAuditName(interaction: AdminGuardInteraction): string {
  const parts = [interaction.commandName || "unknown", getCommandGroup(interaction), getCommandSubcommand(interaction)]
    .filter(Boolean);
  return `/${parts.join(" ")}`;
}

export function isAdminProtectedCommand(interaction: AdminGuardInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || typeof interaction.commandName !== "string") return false;
  return isRouterAdminCommandPath(interaction.commandName, getCommandSubcommand(interaction));
}

export function isSensitiveAdminCommand(interaction: AdminGuardInteraction): boolean {
  return isSensitiveCommandPath(interaction.commandName || "", getCommandSubcommand(interaction));
}

export function isOwnerOnlyAdminAccessCommand(interaction: AdminGuardInteraction): boolean {
  return isOwnerOnlyCommandPath(interaction.commandName || "", getCommandSubcommand(interaction));
}

export async function resolveOwnerId(interaction: AdminGuardInteraction): Promise<string> {
  const guild = interaction.guild;
  if (!guild) return "";
  if (typeof guild.ownerId === "string" && guild.ownerId) return guild.ownerId;
  if (typeof guild.fetchOwner !== "function") return "";
  const owner = await guild.fetchOwner().catch(() => null);
  return owner?.id || owner?.user?.id || "";
}

export async function isGuildOwner(interaction: AdminGuardInteraction): Promise<boolean> {
  const userId = interaction.user?.id || "";
  return Boolean(userId && (await resolveOwnerId(interaction)) === userId);
}

export function hasSensitiveUserAccess(
  interaction: AdminGuardInteraction,
  env?: { BOT_SENSITIVE_USER_IDS?: readonly string[] }
): boolean {
  const allowlist = env?.BOT_SENSITIVE_USER_IDS ?? parseIdList(process.env.BOT_SENSITIVE_USER_IDS);
  return isSensitiveUserAllowed(allowlist, interaction.user?.id || "");
}

export function guildIdOf(interaction: AdminGuardInteraction): string {
  return typeof interaction.guild?.id === "string" ? interaction.guild.id : "";
}

function hasLean(result: GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>): result is GuildAdminAccessQuery {
  return "lean" in result && typeof result.lean === "function";
}

export function canUseGuildModel(model: GuildModelLike | null | undefined): model is GuildModelLike {
  return Boolean(model) && !(typeof model?.db?.readyState === "number" && model.db.readyState !== 1);
}

export async function loadAdminAccessDoc(
  target: AdminCommandGuardContext | null | undefined,
  guildId: string
): Promise<GuildAdminAccessDoc | null> {
  const model = target?.GuildModel;
  if (!canUseGuildModel(model) || typeof model.findOne !== "function") return null;
  const result = model.findOne({ _id: guildId });
  const doc = hasLean(result) ? await result.lean() : await result;
  return doc || null;
}

export async function loadAdminCommandAccessConfig(
  target: AdminCommandGuardContext | null | undefined,
  guildId: string,
  interaction?: AdminGuardInteraction
): Promise<AdminCommandAccessConfig | null> {
  const doc = await loadAdminAccessDoc(target, guildId);
  return interaction ? resolveAdminCommandAccessForScope(doc, buildAdminCommandAccessScope(interaction)) : doc?.adminCommandAccess || null;
}
