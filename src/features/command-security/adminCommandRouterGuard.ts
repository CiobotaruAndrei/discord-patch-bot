"use strict";

import { recordBotAuditEntry } from "../admin-records/adminRecordsRepository";
import { isHandledCommandError } from "./commandOutcome";

const { MessageFlags } = require("discord.js");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type AdminGuardPayload = { content: string; flags: number };
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string; roles?: { cache?: RoleCacheLike | null } | null } | null;
  member?: { roles?: MemberRolesLike | null } | null;
  memberPermissions?: { has: (permission: unknown) => boolean } | null;
  user?: { id?: string } | null;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
  options?: {
    getSubcommand?: (required?: boolean) => string;
    getSubcommandGroup?: (required?: boolean) => string | null;
  };
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type RequireGuildAdmin = (interaction: DiscordInteraction) => Promise<boolean>;
type RoleLike = { id?: string; position?: number };
type RoleCacheLike = {
  has: (roleId: string) => boolean;
  get?: (roleId: string) => RoleLike | undefined;
};
type MemberRolesLike = RoleCacheLike | { cache?: RoleCacheLike | null; highest?: RoleLike | null };
type AdminRoleAccessMode = "role" | "role-or-higher";
type AdminCommandAccessConfig = { mode?: AdminRoleAccessMode | null; roleId?: string | null };
type GuildAdminAccessDoc = { adminCommandAccess?: AdminCommandAccessConfig | null };
type GuildAdminAccessQuery = { lean: () => Promise<GuildAdminAccessDoc | null> };
type GuildAdminAccessModel = Parameters<typeof recordBotAuditEntry>[0] & {
  findOne?: (filter: { _id: string }) => GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>;
  db?: { readyState?: number };
};
type GuildModelLike = GuildAdminAccessModel;

type AdminCommandGuardDeps = {
  requireGuildAdmin: RequireGuildAdmin;
};

type AdminCommandGuardContext = {
  handleInteraction?: NextInteractionHandler;
  GuildModel?: GuildModelLike;
};

type DefaultRequireGuildAdmin = RequireGuildAdmin & {
  isGuildAdmin: (interaction: DiscordInteraction) => boolean;
  hasConfiguredAdminRole: (interaction: DiscordInteraction, config: AdminCommandAccessConfig | null | undefined) => boolean;
  rejectNonAdmin: (interaction: DiscordInteraction) => Promise<void>;
};

const defaultRequireGuildAdmin = require("./adminPermissionGuard") as DefaultRequireGuildAdmin;
const ADMIN_COMMANDS = new Set([
  "start", "stop", "set", "outbox", "health", "config", "reset-config",
  "admin-alerts", "price-alert", "youtube", "sources", "watchlist", "snooze", "unsnooze",
  "backup", "bot-log", "server-log", "future-release", "maintenance", "admin-command-access", "delete"
]);
const PUBLIC_VERB_SUBCOMMANDS = new Set(["suggestion"]);
const SENSITIVE_ADMIN_COMMANDS = new Set(["reset-config"]);
const SENSITIVE_BACKUP_SUBCOMMANDS = new Set(["load", "delete"]);
const SENSITIVE_OUTBOX_SUBCOMMANDS = new Set(["clear-deadletters", "replay-deadletters", "pause", "resume", "drain-now"]);
const ADMIN_OUTSIDE_GUILD_MESSAGE = "Eroare: Comenzile administrative sunt disponibile doar pe servere, nu in mesaje directe.";
const ADMIN_SENSITIVE_USER_MESSAGE = "Access denied.";

function isAdminProtectedCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || typeof interaction.commandName !== "string") return false;
  const commandName = interaction.commandName;
  if (commandName === "add" || commandName === "remove") {
    return !(commandName === "add" && PUBLIC_VERB_SUBCOMMANDS.has(getCommandSubcommand(interaction)));
  }
  return ADMIN_COMMANDS.has(commandName);
}

function parseIdList(value: string | undefined): string[] {
  return String(value || "").split(",").map(id => id.trim()).filter(Boolean);
}

function getCommandSubcommand(interaction: DiscordInteraction): string {
  try {
    return interaction.options?.getSubcommand?.(false) || "";
  } catch {
    return "";
  }
}

function getCommandGroup(interaction: DiscordInteraction): string {
  try {
    return interaction.options?.getSubcommandGroup?.(false) || "";
  } catch {
    return "";
  }
}

function commandAuditName(interaction: DiscordInteraction): string {
  const parts = [interaction.commandName || "unknown", getCommandGroup(interaction), getCommandSubcommand(interaction)]
    .filter(Boolean);
  return `/${parts.join(" ")}`;
}

function isSensitiveAdminCommand(interaction: DiscordInteraction): boolean {
  const commandName = interaction.commandName || "";
  const subcommand = getCommandSubcommand(interaction);
  if (SENSITIVE_ADMIN_COMMANDS.has(commandName)) return true;
  if (commandName === "backup") return SENSITIVE_BACKUP_SUBCOMMANDS.has(subcommand);
  if (commandName === "outbox") return SENSITIVE_OUTBOX_SUBCOMMANDS.has(subcommand);
  return false;
}

function hasSensitiveUserAccess(interaction: DiscordInteraction): boolean {
  const allowed = parseIdList(process.env.BOT_SENSITIVE_USER_IDS);
  if (!allowed.length) return true;
  const userId = interaction.user?.id || "";
  return allowed.includes(userId);
}

async function rejectOutsideGuild(interaction: DiscordInteraction): Promise<void> {
  const payload: AdminGuardPayload = { content: ADMIN_OUTSIDE_GUILD_MESSAGE, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

async function rejectSensitiveUser(interaction: DiscordInteraction): Promise<void> {
  const payload: AdminGuardPayload = { content: ADMIN_SENSITIVE_USER_MESSAGE, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

function guildIdOf(interaction: DiscordInteraction): string {
  return typeof interaction.guild?.id === "string" ? interaction.guild.id : "";
}

function hasLean(result: GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>): result is GuildAdminAccessQuery {
  return "lean" in result && typeof result.lean === "function";
}

function canUseGuildModel(model: GuildModelLike | null | undefined): model is GuildModelLike {
  return Boolean(model) && !(typeof model?.db?.readyState === "number" && model.db.readyState !== 1);
}

async function loadAdminCommandAccessConfig(
  target: AdminCommandGuardContext | null | undefined,
  guildId: string
): Promise<AdminCommandAccessConfig | null> {
  const model = target?.GuildModel;
  if (!canUseGuildModel(model) || typeof model.findOne !== "function") return null;
  const result = model.findOne({ _id: guildId });
  const doc = hasLean(result) ? await result.lean() : await result;
  return doc?.adminCommandAccess || null;
}

async function requireGuildAdminWithConfiguredAccess(
  target: AdminCommandGuardContext,
  interaction: DiscordInteraction
): Promise<boolean> {
  if (defaultRequireGuildAdmin.isGuildAdmin(interaction)) return true;
  const guildId = guildIdOf(interaction);
  const config = guildId ? await loadAdminCommandAccessConfig(target, guildId).catch(() => null) : null;
  if (defaultRequireGuildAdmin.hasConfiguredAdminRole(interaction, config)) return true;
  await defaultRequireGuildAdmin.rejectNonAdmin(interaction);
  return false;
}

async function recordAdminAudit(
  target: AdminCommandGuardContext | null | undefined,
  interaction: DiscordInteraction,
  result: string,
  details = ""
): Promise<void> {
  const guildId = guildIdOf(interaction);
  if (!guildId || !canUseGuildModel(target?.GuildModel)) return;
  await recordBotAuditEntry(target.GuildModel, guildId, {
    userId: interaction.user?.id || "",
    command: commandAuditName(interaction),
    result,
    details
  }).catch(() => undefined);
}

function createAdminCommandGuard(
  deps: AdminCommandGuardDeps = { requireGuildAdmin: defaultRequireGuildAdmin },
  target?: AdminCommandGuardContext
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
    if (!(await deps.requireGuildAdmin(interaction))) {
      await recordAdminAudit(target, interaction, "Access denied.");
      return undefined;
    }
    if (isSensitiveAdminCommand(interaction) && !hasSensitiveUserAccess(interaction)) {
      await rejectSensitiveUser(interaction);
      await recordAdminAudit(target, interaction, "Access denied.");
      return undefined;
    }
    if (typeof next === "function") {
      try {
        const result = await next(interaction, games);
        if (isHandledCommandError(result)) {
          await recordAdminAudit(target, interaction, "Command error.", result.reason);
        } else {
          await recordAdminAudit(target, interaction, "Access granted.");
        }
        return result;
      } catch (err: unknown) {
        await recordAdminAudit(target, interaction, "Error.", String(err instanceof Error ? err.message : err));
        throw err;
      }
    }
    return undefined;
  }

  return { handleAdminProtectedCommand };
}

function installAdminCommandGuard(target: AdminCommandGuardContext) {
  const previousHandleInteraction = target.handleInteraction;
  const guard = createAdminCommandGuard({ requireGuildAdmin: interaction => requireGuildAdminWithConfiguredAccess(target, interaction) }, target);

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
  isAdminProtectedCommand,
  isSensitiveAdminCommand,
  hasSensitiveUserAccess,
  loadAdminCommandAccessConfig
});

export = installAdminCommandGuard;
