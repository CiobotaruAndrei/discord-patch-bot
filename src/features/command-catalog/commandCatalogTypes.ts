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

export interface CommandCatalogHelpEntry {
  command: string;
  ephemeral?: boolean;
  description: string;
  example: string;
  notes?: readonly string[];
  aliases?: readonly string[];
}

export type CommandCatalogDomain = "core" | "game-info" | "notifications" | "youtube" | "admin";
