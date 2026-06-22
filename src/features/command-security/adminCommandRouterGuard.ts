"use strict";

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: unknown;
  isChatInputCommand?: () => boolean;
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

function isAdminProtectedCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && typeof interaction.commandName === "string"
    && ADMIN_COMMANDS.has(interaction.commandName);
}

function createAdminCommandGuard(
  deps: AdminCommandGuardDeps = { requireGuildAdmin: defaultRequireGuildAdmin }
) {
  async function handleAdminProtectedCommand(
    interaction: DiscordInteraction,
    games: GameConfig[],
    next?: NextInteractionHandler
  ): Promise<unknown> {
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
