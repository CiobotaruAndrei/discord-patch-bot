"use strict";

export type CommandAccessTier = "public" | "admin";

export interface CommandAccessRule {
  command: string;
  access: CommandAccessTier;
  discordAdminPermissions: boolean;
  publicSubcommands?: readonly string[];
  adminRuntimeSubcommands?: readonly string[];
  ownerOnly?: boolean;
  ownerOnlySubcommands?: readonly string[];
  sensitiveSubcommands?: readonly string[] | "all";
}

export const COMMAND_ACCESS_MANIFEST: readonly CommandAccessRule[] = [
  { command: "ping", access: "public", discordAdminPermissions: false },
  { command: "games", access: "public", discordAdminPermissions: false },
  { command: "help", access: "public", discordAdminPermissions: false },
  { command: "status", access: "public", discordAdminPermissions: false },
  { command: "latest", access: "public", discordAdminPermissions: false },
  { command: "history", access: "public", discordAdminPermissions: false },
  { command: "dlc", access: "public", discordAdminPermissions: false },
  { command: "price-check", access: "public", discordAdminPermissions: false },
  { command: "deal-score", access: "public", discordAdminPermissions: false },
  { command: "best", access: "public", discordAdminPermissions: false },
  { command: "ending", access: "public", discordAdminPermissions: false },
  { command: "review-trend", access: "public", discordAdminPermissions: false },
  { command: "crossplay", access: "public", discordAdminPermissions: false },
  { command: "platforms", access: "public", discordAdminPermissions: false },
  { command: "co-op", access: "public", discordAdminPermissions: false },
  { command: "system", access: "public", discordAdminPermissions: false },
  { command: "game-size", access: "public", discordAdminPermissions: false },
  { command: "player-count", access: "public", discordAdminPermissions: false },
  { command: "top", access: "public", discordAdminPermissions: false },
  { command: "report", access: "public", discordAdminPermissions: false, adminRuntimeSubcommands: ["list", "resolve"] },
  { command: "suggest-command", access: "public", discordAdminPermissions: false, adminRuntimeSubcommands: ["list", "delete"] },
  { command: "watchlist-game", access: "public", discordAdminPermissions: false, adminRuntimeSubcommands: ["delete"] },
  { command: "add", access: "admin", discordAdminPermissions: false, publicSubcommands: ["suggestion"] },
  { command: "remove", access: "admin", discordAdminPermissions: false },
  { command: "delete", access: "admin", discordAdminPermissions: true, ownerOnlySubcommands: ["admin-command-access"] },
  { command: "start", access: "admin", discordAdminPermissions: true },
  { command: "stop", access: "admin", discordAdminPermissions: true },
  { command: "set", access: "admin", discordAdminPermissions: true, ownerOnlySubcommands: ["admin-command-access"] },
  { command: "watchlist", access: "admin", discordAdminPermissions: true },
  { command: "snooze", access: "admin", discordAdminPermissions: true },
  { command: "unsnooze", access: "admin", discordAdminPermissions: true },
  { command: "config", access: "admin", discordAdminPermissions: true },
  { command: "reset-config", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: "all" },
  { command: "backup", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: ["load", "delete"] },
  { command: "bot-log", access: "admin", discordAdminPermissions: true },
  { command: "server-log", access: "admin", discordAdminPermissions: true },
  { command: "admin-alerts", access: "admin", discordAdminPermissions: true },
  { command: "admin-command-access", access: "admin", discordAdminPermissions: true, ownerOnly: true },
  { command: "price-alert", access: "admin", discordAdminPermissions: true },
  { command: "youtube", access: "admin", discordAdminPermissions: true },
  { command: "future-release", access: "admin", discordAdminPermissions: true },
  { command: "maintenance", access: "admin", discordAdminPermissions: true },
  { command: "sources", access: "admin", discordAdminPermissions: true },
  { command: "outbox", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: ["clear-deadletters", "replay-deadletters", "pause", "resume", "drain-now"] },
  { command: "health", access: "admin", discordAdminPermissions: true }
];

const RULE_BY_COMMAND = new Map(COMMAND_ACCESS_MANIFEST.map(rule => [rule.command, rule] as const));

function ruleFor(commandName: string | null | undefined): CommandAccessRule | null {
  return RULE_BY_COMMAND.get(String(commandName || "")) ?? null;
}

export function isRouterAdminCommandPath(commandName: string, subcommand: string): boolean {
  const rule = ruleFor(commandName);
  if (!rule || rule.access !== "admin") return false;
  return !(rule.publicSubcommands?.includes(subcommand) ?? false);
}

export function isRuntimeAdminCommandPath(commandName: string, subcommand: string): boolean {
  return Boolean(ruleFor(commandName)?.adminRuntimeSubcommands?.includes(subcommand));
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
