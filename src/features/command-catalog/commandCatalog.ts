"use strict";

import type { CommandAccessRule, CommandCatalogHelpEntry } from "./commandCatalogTypes.js";
import { CORE_COMMAND_ACCESS, CORE_CATALOG_HELP } from "./coreCatalog.js";
import { GAME_INFO_COMMAND_ACCESS, GAME_INFO_CATALOG_HELP } from "./gameInfoCatalog.js";
import { NOTIFICATIONS_COMMAND_ACCESS, NOTIFICATIONS_CATALOG_HELP } from "./notificationsCatalog.js";
import { YOUTUBE_COMMAND_ACCESS, YOUTUBE_CATALOG_HELP } from "./youtubeCatalog.js";
import { ADMIN_COMMAND_ACCESS, ADMIN_CATALOG_HELP } from "./adminCatalog.js";

export type { CommandAccessTier, CommandAccessRule, CommandCatalogHelpEntry, CommandCatalogDomain } from "./commandCatalogTypes.js";

export const COMMAND_ACCESS_MANIFEST: readonly CommandAccessRule[] = [
  ...CORE_COMMAND_ACCESS,
  ...GAME_INFO_COMMAND_ACCESS,
  ...NOTIFICATIONS_COMMAND_ACCESS,
  ...YOUTUBE_COMMAND_ACCESS,
  ...ADMIN_COMMAND_ACCESS
];

export const COMMAND_CATALOG_HELP: readonly CommandCatalogHelpEntry[] = [
  ...CORE_CATALOG_HELP,
  ...GAME_INFO_CATALOG_HELP,
  ...NOTIFICATIONS_CATALOG_HELP,
  ...YOUTUBE_CATALOG_HELP,
  ...ADMIN_CATALOG_HELP
];

const RULE_BY_COMMAND = new Map(COMMAND_ACCESS_MANIFEST.map(rule => [rule.command, rule] as const));

function ruleFor(commandName: string | null | undefined): CommandAccessRule | null {
  return RULE_BY_COMMAND.get(String(commandName || "")) ?? null;
}

function nestedPath(group: string, subcommand: string): string {
  return [group, subcommand].filter(Boolean).join(" ");
}

export function isRouterAdminCommandPath(commandName: string, subcommand: string, group = ""): boolean {
  const rule = ruleFor(commandName);
  if (!rule) return false;
  if (rule.adminRuntimeSubcommands?.includes(subcommand)) return true;
  if (rule.adminRuntimePaths?.includes(nestedPath(group, subcommand))) return true;
  if (rule.access !== "admin") return false;
  return !(rule.publicSubcommands?.includes(subcommand) ?? false);
}

export function isRuntimeAdminCommandPath(commandName: string, subcommand: string, group = ""): boolean {
  const rule = ruleFor(commandName);
  return Boolean(rule?.adminRuntimeSubcommands?.includes(subcommand)
    || rule?.adminRuntimePaths?.includes(nestedPath(group, subcommand)));
}

export function isConfigurableAdminCommandPath(commandName: string, subcommand: string, group = ""): boolean {
  const rule = ruleFor(commandName);
  if (!rule || rule.adminRuntimeSubcommands?.includes(subcommand) || rule.publicSubcommands?.includes(subcommand)) return false;
  return rule.access === "admin" || Boolean(rule.adminRuntimePaths?.includes(nestedPath(group, subcommand)));
}

export function isOwnerOnlyCommandPath(commandName: string, subcommand: string): boolean {
  const rule = ruleFor(commandName);
  if (!rule) return false;
  if (rule.ownerOnly === true) return true;
  return Boolean(rule.ownerOnlySubcommands?.includes(subcommand));
}

export function isSensitiveCommandPath(commandName: string, subcommand: string): boolean {
  const rule = ruleFor(commandName);
  if (!rule?.sensitiveSubcommands) return false;
  if (rule.sensitiveSubcommands === "all") return true;
  return rule.sensitiveSubcommands.includes(subcommand);
}

export function permissionsLabelFor(path: string, ephemeral?: boolean): string {
  const tokens = path.replace(/^\/+/, "").split(" ");
  const commandName = tokens[0] ?? "";
  const group = tokens.length >= 3 ? tokens[1] ?? "" : "";
  const subcommand = tokens.length >= 3 ? tokens[2] ?? "" : tokens[1] ?? "";
  const rule = ruleFor(commandName);
  if (!rule) return ephemeral ? "Public, Ephemeral" : "Public";
  if (isOwnerOnlyCommandPath(commandName, subcommand)) {
    return "Admin top-level, owner-only runtime, Ephemeral";
  }
  if (rule.access === "admin" && !(rule.publicSubcommands?.includes(subcommand) ?? false)) {
    return rule.discordAdminPermissions ? "Admin, Ephemeral" : "Admin runtime, Ephemeral";
  }
  if (isRuntimeAdminCommandPath(commandName, subcommand, group)) {
    return "Admin runtime, Ephemeral";
  }
  return ephemeral ? "Public, Ephemeral" : "Public";
}
