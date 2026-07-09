"use strict";

export interface CommandDescriptor {
  commandNames: readonly string[];
  requireGuild?: boolean;
  group?: string | null;
  subcommand?: string;
}

interface CommandMatchInteraction {
  commandName?: string;
  guild?: unknown;
  isChatInputCommand?: () => boolean;
  options?: {
    getSubcommandGroup?: (required?: boolean) => string | null;
    getSubcommand?: (required?: boolean) => string | null;
  };
}

function readGroup(interaction: CommandMatchInteraction): string | null {
  try {
    return interaction.options?.getSubcommandGroup?.(false) ?? null;
  } catch {
    return null;
  }
}

function readSubcommand(interaction: CommandMatchInteraction): string | null {
  try {
    return interaction.options?.getSubcommand?.(false) ?? null;
  } catch {
    return null;
  }
}

export function matchesCommand(interaction: unknown, descriptor: CommandDescriptor): boolean {
  if (typeof interaction !== "object" || interaction === null) return false;
  const candidate = interaction as CommandMatchInteraction;
  if (candidate.isChatInputCommand?.() !== true) return false;
  if (descriptor.requireGuild !== false && !candidate.guild) return false;
  if (typeof candidate.commandName !== "string" || !descriptor.commandNames.includes(candidate.commandName)) return false;
  if (descriptor.group !== undefined && readGroup(candidate) !== descriptor.group) return false;
  if (descriptor.subcommand !== undefined && readSubcommand(candidate) !== descriptor.subcommand) return false;
  return true;
}
