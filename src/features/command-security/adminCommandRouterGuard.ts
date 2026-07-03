"use strict";

import { isHandledCommandError } from "./commandOutcome";
import { buildAdminCommandAccessScope, resolveAdminCommandAccessForScope } from "./adminCommandAccessScope";
import {
  guildIdOf,
  hasSensitiveUserAccess,
  isAdminProtectedCommand,
  isGuildOwner,
  isOwnerOnlyAdminAccessCommand,
  isSensitiveAdminCommand,
  loadAdminAccessDoc,
  loadAdminCommandAccessConfig
} from "./adminAccessResolver";
import { promptGlobalAccessCode } from "./globalAccessCodeModal";
import { recordAdminAudit } from "./adminAuditRecorder";
import type {
  AdminCommandGuardContext,
  AdminCommandGuardDeps,
  AdminGuardGameConfig,
  AdminGuardInteraction,
  AdminGuardPayload,
  DefaultRequireGuildAdmin,
  NextInteractionHandler
} from "./adminGuardContracts";

const { MessageFlags } = require("discord.js") as typeof import("discord.js");

const defaultRequireGuildAdmin = require("./adminPermissionGuard") as DefaultRequireGuildAdmin;
const ADMIN_OUTSIDE_GUILD_MESSAGE = "Eroare: Comenzile administrative sunt disponibile doar pe servere, nu in mesaje directe.";
const ADMIN_SENSITIVE_USER_MESSAGE = "Access denied.";

async function rejectOutsideGuild(interaction: AdminGuardInteraction): Promise<void> {
  const payload: AdminGuardPayload = { content: ADMIN_OUTSIDE_GUILD_MESSAGE, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

async function rejectSensitiveUser(interaction: AdminGuardInteraction): Promise<void> {
  const payload: AdminGuardPayload = { content: ADMIN_SENSITIVE_USER_MESSAGE, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

async function authorizeGuildAdminWithConfiguredAccess(
  target: AdminCommandGuardContext,
  interaction: AdminGuardInteraction
): Promise<AdminGuardInteraction | null> {
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
  interaction: AdminGuardInteraction
): Promise<boolean> {
  return Boolean(await authorizeGuildAdminWithConfiguredAccess(target, interaction));
}

function createAdminCommandGuard(
  deps: AdminCommandGuardDeps = { requireGuildAdmin: defaultRequireGuildAdmin },
  target?: AdminCommandGuardContext
) {
  async function handleAdminProtectedCommand(
    interaction: AdminGuardInteraction,
    games: AdminGuardGameConfig[],
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

  async function handleInteraction(interaction: AdminGuardInteraction, games: AdminGuardGameConfig[]) {
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
