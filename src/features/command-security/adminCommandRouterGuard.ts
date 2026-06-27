"use strict";

const { MessageFlags } = require("discord.js");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type AdminGuardPayload = { content: string; flags: number };
type DiscordInteraction = {
  commandName?: string;
  guild?: unknown;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type RequireGuildAdmin = (interaction: DiscordInteraction) => Promise<boolean>;

type AdminCommandGuardDeps = {
  requireGuildAdmin: RequireGuildAdmin;
};

type AdminCommandGuardContext = {
  handleInteraction?: NextInteractionHandler;
};

const defaultRequireGuildAdmin = require("./adminPermissionGuard") as RequireGuildAdmin;
const ADMIN_COMMANDS = new Set(["start", "stop", "set", "outbox", "health"]);
const ADMIN_OUTSIDE_GUILD_MESSAGE = "Eroare: Comenzile administrative sunt disponibile doar pe servere, nu in mesaje directe.";

function isAdminProtectedCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && typeof interaction.commandName === "string"
    && ADMIN_COMMANDS.has(interaction.commandName);
}

async function rejectOutsideGuild(interaction: DiscordInteraction): Promise<void> {
  const payload: AdminGuardPayload = { content: ADMIN_OUTSIDE_GUILD_MESSAGE, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

function createAdminCommandGuard(
  deps: AdminCommandGuardDeps = { requireGuildAdmin: defaultRequireGuildAdmin }
) {
  async function handleAdminProtectedCommand(
    interaction: DiscordInteraction,
    games: GameConfig[],
    next?: NextInteractionHandler
  ): Promise<unknown> {
    if (!interaction.guild) {
      await rejectOutsideGuild(interaction);
      return undefined;
    }
    if (!(await deps.requireGuildAdmin(interaction))) return undefined;
    if (typeof next === "function") return next(interaction, games);
    return undefined;
  }

  return { handleAdminProtectedCommand };
}

function installAdminCommandGuard(target: AdminCommandGuardContext) {
  const previousHandleInteraction = target.handleInteraction;
  const guard = createAdminCommandGuard();

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isAdminProtectedCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    return guard.handleAdminProtectedCommand(interaction, games, previousHandleInteraction);
  }

  Object.assign(target, { handleInteraction });
}

Object.assign(installAdminCommandGuard, {
  createAdminCommandGuard,
  isAdminProtectedCommand
});

export = installAdminCommandGuard;
