"use strict";

import { recordBotAuditEntry } from "../admin-records/adminRecordsRepository";
import { isHandledCommandError } from "./commandOutcome";
import {
  buildAdminCommandAccessScope,
  resolveAdminCommandAccessForScope,
  type AdminCommandAccessByCommand,
  type AdminCommandAccessConfig
} from "./adminCommandAccessScope";
import globalAccessCode = require("./globalAccessCode");
import { isOwnerOnlyCommandPath, isRouterAdminCommandPath, isSensitiveCommandPath } from "./commandAccessManifest";

const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js") as typeof import("discord.js");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type AdminGuardPayload = { content: string; flags: number };
type ModalSubmitLike = {
  user?: { id?: string } | null;
  customId?: string;
  deferred?: boolean;
  replied?: boolean;
  fields?: { getTextInputValue?: (customId: string) => string };
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
  deferReply?: (payload?: unknown) => Promise<unknown>;
  editReply?: (payload: unknown) => Promise<unknown>;
};
type GuildOwnerMember = {
  id?: string;
  user?: { id?: string } | null;
};
type DiscordInteraction = {
  commandName?: string;
  guild?: {
    id?: string;
    ownerId?: string | null;
    fetchOwner?: () => Promise<GuildOwnerMember | null>;
    roles?: { cache?: RoleCacheLike | null } | null;
  } | null;
  member?: { roles?: MemberRolesLike | null } | null;
  memberPermissions?: { has: (permission: unknown) => boolean } | null;
  user?: { id?: string } | null;
  globalAccessCodeAuthorized?: boolean;
  isChatInputCommand?: () => boolean;
  deferred?: boolean;
  replied?: boolean;
  reply?: (payload: AdminGuardPayload) => Promise<unknown>;
  followUp?: (payload: AdminGuardPayload) => Promise<unknown>;
  deferReply?: (payload?: unknown) => Promise<unknown>;
  editReply?: (payload: unknown) => Promise<unknown>;
  showModal?: (modal: unknown) => Promise<unknown>;
  awaitModalSubmit?: (options: { filter: (interaction: ModalSubmitLike) => boolean; time: number }) => Promise<ModalSubmitLike>;
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
type GuildAdminAccessDoc = {
  adminCommandAccess?: AdminCommandAccessConfig | null;
  adminCommandAccessByCommand?: AdminCommandAccessByCommand | null;
};
type GuildAdminAccessQuery = { lean: () => Promise<GuildAdminAccessDoc | null> };
type GuildAdminAccessModel = Parameters<typeof recordBotAuditEntry>[0] & {
  findOne?: (filter: { _id: string }) => GuildAdminAccessQuery | Promise<GuildAdminAccessDoc | null>;
  db?: { readyState?: number };
};
type GuildModelLike = GuildAdminAccessModel;

type AdminCommandGuardDeps = {
  requireGuildAdmin: RequireGuildAdmin;
  authorizeGuildAdmin?: (interaction: DiscordInteraction) => Promise<DiscordInteraction | null>;
};

type AdminCommandGuardContext = {
  handleInteraction?: NextInteractionHandler;
  GuildModel?: GuildModelLike;
  adminAlert?: (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;
};

type DefaultRequireGuildAdmin = RequireGuildAdmin & {
  isGuildAdmin: (interaction: DiscordInteraction) => boolean;
  hasConfiguredAdminRole: (interaction: DiscordInteraction, config: AdminCommandAccessConfig | null | undefined) => boolean;
  rejectNonAdmin: (interaction: DiscordInteraction) => Promise<void>;
};

const defaultRequireGuildAdmin = require("./adminPermissionGuard") as DefaultRequireGuildAdmin;
const ADMIN_OUTSIDE_GUILD_MESSAGE = "Eroare: Comenzile administrative sunt disponibile doar pe servere, nu in mesaje directe.";
const ADMIN_SENSITIVE_USER_MESSAGE = "Access denied.";
const ACCESS_CODE_MODAL_INPUT_ID = "access-code";
const ACCESS_CODE_MODAL_TIMEOUT_MS = 60_000;
const ACCESS_CODE_LOCK_MS = 15 * 60_000;
const ACCESS_CODE_FAILURE_WINDOW_MS = 10 * 60_000;
const ACCESS_CODE_MAX_FAILURES = 5;
const accessCodeFailures = new Map<string, { count: number; firstFailedAt: number; lockedUntil: number; alertSent: boolean }>();

function isAdminProtectedCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || typeof interaction.commandName !== "string") return false;
  return isRouterAdminCommandPath(interaction.commandName, getCommandSubcommand(interaction));
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
  return isSensitiveCommandPath(interaction.commandName || "", getCommandSubcommand(interaction));
}

function isOwnerOnlyAdminAccessCommand(interaction: DiscordInteraction): boolean {
  return isOwnerOnlyCommandPath(interaction.commandName || "", getCommandSubcommand(interaction));
}

async function resolveOwnerId(interaction: DiscordInteraction): Promise<string> {
  const guild = interaction.guild;
  if (!guild) return "";
  if (typeof guild.ownerId === "string" && guild.ownerId) return guild.ownerId;
  if (typeof guild.fetchOwner !== "function") return "";
  const owner = await guild.fetchOwner().catch(() => null);
  return owner?.id || owner?.user?.id || "";
}

async function isGuildOwner(interaction: DiscordInteraction): Promise<boolean> {
  const userId = interaction.user?.id || "";
  return Boolean(userId && (await resolveOwnerId(interaction)) === userId);
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
  guildId: string,
  interaction?: DiscordInteraction
): Promise<AdminCommandAccessConfig | null> {
  const doc = await loadAdminAccessDoc(target, guildId);
  return interaction ? resolveAdminCommandAccessForScope(doc, buildAdminCommandAccessScope(interaction)) : doc?.adminCommandAccess || null;
}

async function replyEphemeral(interaction: DiscordInteraction | ModalSubmitLike, content: string): Promise<void> {
  const payload: AdminGuardPayload = { content, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

async function loadAdminAccessDoc(
  target: AdminCommandGuardContext | null | undefined,
  guildId: string
): Promise<GuildAdminAccessDoc | null> {
  const model = target?.GuildModel;
  if (!canUseGuildModel(model) || typeof model.findOne !== "function") return null;
  const result = model.findOne({ _id: guildId });
  const doc = hasLean(result) ? await result.lean() : await result;
  return doc || null;
}

function accessFailureKey(interaction: DiscordInteraction): string {
  return `${guildIdOf(interaction)}:${interaction.user?.id || ""}`;
}

function activeFailureState(key: string, nowMs: number) {
  const state = accessCodeFailures.get(key);
  if (!state) return null;
  if (state.lockedUntil > nowMs) return state;
  if (state.firstFailedAt + ACCESS_CODE_FAILURE_WINDOW_MS < nowMs) {
    accessCodeFailures.delete(key);
    return null;
  }
  return state;
}

function clearAccessCodeFailures(interaction: DiscordInteraction): void {
  accessCodeFailures.delete(accessFailureKey(interaction));
}

async function recordAccessCodeFailure(target: AdminCommandGuardContext, interaction: DiscordInteraction): Promise<void> {
  const key = accessFailureKey(interaction);
  if (!interaction.user?.id || !guildIdOf(interaction)) return;
  const nowMs = Date.now();
  const current = activeFailureState(key, nowMs);
  const next = current || { count: 0, firstFailedAt: nowMs, lockedUntil: 0, alertSent: false };
  next.count += 1;
  if (next.count >= ACCESS_CODE_MAX_FAILURES) next.lockedUntil = nowMs + ACCESS_CODE_LOCK_MS;
  accessCodeFailures.set(key, next);
  if (next.lockedUntil > nowMs && !next.alertSent) {
    next.alertSent = true;
    await target.adminAlert?.(
      "security:access-code",
      "Incercari esuate pentru codul de acces global",
      `User ${interaction.user.id} a introdus codul global gresit de ${next.count} ori pentru ${commandAuditName(interaction)}.`,
      guildIdOf(interaction)
    ).catch(() => undefined);
  }
}

function isAccessCodeLocked(interaction: DiscordInteraction): boolean {
  return Boolean(activeFailureState(accessFailureKey(interaction), Date.now())?.lockedUntil);
}

async function promptGlobalAccessCode(target: AdminCommandGuardContext, interaction: DiscordInteraction): Promise<DiscordInteraction | null> {
  if (isAccessCodeLocked(interaction)) {
    await replyEphemeral(interaction, "Access denied.");
    return null;
  }
  if (typeof interaction.showModal !== "function" || typeof interaction.awaitModalSubmit !== "function") {
    await defaultRequireGuildAdmin.rejectNonAdmin(interaction);
    return null;
  }
  const userId = interaction.user?.id || "";
  if (!userId) {
    await defaultRequireGuildAdmin.rejectNonAdmin(interaction);
    return null;
  }
  const customId = `global-access-code:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const input = new TextInputBuilder()
    .setCustomId(ACCESS_CODE_MODAL_INPUT_ID)
    .setLabel("Cod de acces")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(128);
  const row = new ActionRowBuilder<InstanceType<typeof TextInputBuilder>>().addComponents(input);
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Cod acces admin")
    .addComponents(row);
  await interaction.showModal(modal);
  const submit = await interaction.awaitModalSubmit({
    time: ACCESS_CODE_MODAL_TIMEOUT_MS,
    filter: modalInteraction => modalInteraction.customId === customId && modalInteraction.user?.id === userId
  }).catch(() => null);
  if (!submit) return null;
  const candidate = submit.fields?.getTextInputValue?.(ACCESS_CODE_MODAL_INPUT_ID) || "";
  const result = globalAccessCode.verifyGlobalAccessCode(candidate);
  if (result !== "valid") {
    await recordAccessCodeFailure(target, interaction);
    await replyEphemeral(submit, "Access denied.");
    return null;
  }
  clearAccessCodeFailures(interaction);
  await replyEphemeral(submit, "Access granted.");
  return {
    ...interaction,
    globalAccessCodeAuthorized: true,
    deferred: submit.deferred,
    replied: submit.replied,
    reply: submit.reply?.bind(submit),
    followUp: submit.followUp?.bind(submit),
    deferReply: submit.deferReply?.bind(submit),
    editReply: submit.editReply?.bind(submit)
  };
}

async function authorizeGuildAdminWithConfiguredAccess(
  target: AdminCommandGuardContext,
  interaction: DiscordInteraction
): Promise<DiscordInteraction | null> {
  if (isOwnerOnlyAdminAccessCommand(interaction) && await isGuildOwner(interaction)) return interaction;
  if (defaultRequireGuildAdmin.isGuildAdmin(interaction)) return interaction;
  const guildId = guildIdOf(interaction);
  const accessDoc = guildId ? await loadAdminAccessDoc(target, guildId).catch(() => null) : null;
  const accessConfig = resolveAdminCommandAccessForScope(accessDoc, buildAdminCommandAccessScope(interaction));
  if (defaultRequireGuildAdmin.hasConfiguredAdminRole(interaction, accessConfig)) return interaction;
  return promptGlobalAccessCode(target, interaction);
}

async function requireGuildAdminWithConfiguredAccess(
  target: AdminCommandGuardContext,
  interaction: DiscordInteraction
): Promise<boolean> {
  return Boolean(await authorizeGuildAdminWithConfiguredAccess(target, interaction));
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
    const authorizedInteraction = deps.authorizeGuildAdmin
      ? await deps.authorizeGuildAdmin(interaction)
      : await deps.requireGuildAdmin(interaction) ? interaction : null;
    if (!authorizedInteraction) {
      await recordAdminAudit(target, interaction, "Access denied.");
      return undefined;
    }
    if (isSensitiveAdminCommand(authorizedInteraction) && !hasSensitiveUserAccess(authorizedInteraction)) {
      await rejectSensitiveUser(authorizedInteraction);
      await recordAdminAudit(target, authorizedInteraction, "Access denied.");
      return undefined;
    }
    if (typeof next === "function") {
      try {
        const result = await next(authorizedInteraction, games);
        if (isHandledCommandError(result)) {
          await recordAdminAudit(target, authorizedInteraction, "Command error.", result.reason);
        } else {
          await recordAdminAudit(target, authorizedInteraction, "Access granted.");
        }
        return result;
      } catch (err: unknown) {
        await recordAdminAudit(target, authorizedInteraction, "Error.", String(err instanceof Error ? err.message : err));
        throw err;
      }
    }
    return undefined;
  }

  return { handleAdminProtectedCommand };
}

function installAdminCommandGuard(target: AdminCommandGuardContext) {
  const previousHandleInteraction = target.handleInteraction;
  const guard = createAdminCommandGuard({
    requireGuildAdmin: interaction => requireGuildAdminWithConfiguredAccess(target, interaction),
    authorizeGuildAdmin: interaction => authorizeGuildAdminWithConfiguredAccess(target, interaction)
  }, target);

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
  isOwnerOnlyAdminAccessCommand,
  isGuildOwner,
  loadAdminCommandAccessConfig,
  loadAdminAccessDoc,
  promptGlobalAccessCode,
  requireGuildAdminWithConfiguredAccess,
  authorizeGuildAdminWithConfiguredAccess
});

export = installAdminCommandGuard;
