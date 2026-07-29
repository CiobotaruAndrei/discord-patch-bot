"use strict";

import type {
  BooleanOption,
  ChatInputInteraction,
  PartialInteractionUserRef,
  RoleOption,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { CommandGame, CommandHandler } from "../command-registry/commandHandler.js";

import { handledCommandError } from "../command-security/commandOutcome.js";
import { loadAdminAccessDoc } from "../command-security/adminAccessRepository.js";
import { sendPaginatedEditFlags } from "../command-presentation/textPagination.js";
import type { GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import type { OperationJournalModelLike } from "../../infra/mongo/operationJournal.js";
import {
  ADMIN_ACCESS_DELETE_KIND,
  ADMIN_ACCESS_SAVE_KIND,
  createOperationJournalRuntime,
  journalResourceVersion,
  OPERATION_PAYLOAD_SCHEMA_VERSION
} from "../admin-records/operationJournalRuntime.js";
import {
  buildAdminCommandAccessScopeLookupKeys,
  displayAdminCommandAccessScope,
  normalizeAdminCommandAccessScope
} from "../command-security/adminCommandAccessScope.js";
import {
  formatAccessList,
  formatScopedAccess,
  labelMode,
  normalizeMode,
  type GuildAdminAccessDoc
} from "./adminCommandAccessViews.js";
import { parseAdminScopeId } from "../command-security/adminScopeIds.js";
import adminCommandRouterGuard from "../command-security/adminCommandRouterGuard.js";
import { errorDetail } from "../../shared/errors.js";
import type { MongoWriteOutcome } from "../../types.js";

type InteractionPayload = string | { content: string; flags?: number };

type DiscordRole = {
  id: string;
  name?: string;
};

type GuildOwnerMember = {
  id?: string;
  user?: { id?: string } | null;
};

type DiscordGuild = {
  id: string;
  ownerId?: string | null;
  fetchOwner?: () => Promise<GuildOwnerMember | null>;
};

type DiscordInteraction = ChatInputInteraction<
  SubcommandOption & RoleOption<DiscordRole> & StringOption & BooleanOption,
  DiscordGuild,
  InteractionPayload
> & {
  user?: PartialInteractionUserRef | null;
  globalAccessCodeAuthorized?: boolean;
};

type GuildFindQuery = {
  lean(): Promise<GuildAdminAccessDoc | null>;
};

type GuildModelLike = {
  updateOne(filter: object, update: object, options?: object): Promise<MongoWriteOutcome>;
  findOne(filter: object): GuildFindQuery | Promise<GuildAdminAccessDoc | null>;
};

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type AdminCommandAccessDeps = {
  GuildModel: GuildModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  OperationJournalModel: OperationJournalModelLike;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
  adminAlert?: (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;
};

type AdminCommandAccessContext = AdminCommandAccessDeps;

function hasLean(result: GuildFindQuery | Promise<GuildAdminAccessDoc | null>): result is GuildFindQuery {
  return "lean" in result && typeof result.lean === "function";
}



async function resolveOwnerId(guild: DiscordGuild): Promise<string> {
  if (typeof guild.ownerId === "string" && guild.ownerId) return guild.ownerId;
  if (typeof guild.fetchOwner !== "function") return "";
  const owner = await guild.fetchOwner().catch(() => null);
  return owner?.id || owner?.user?.id || "";
}

async function isGuildOwner(interaction: DiscordInteraction): Promise<boolean> {
  const userId = interaction.user?.id || "";
  const guild = interaction.guild;
  if (!userId || !guild) return false;
  return (await resolveOwnerId(guild)) === userId;
}

function readTargetScope(interaction: DiscordInteraction): string {
  return normalizeAdminCommandAccessScope(interaction.options.getString("command", false));
}

function createAdminCommandAccessHandler(deps: AdminCommandAccessDeps) {
  const { GuildModel, GuildAuditLogModel, safeDefer, safeEdit, logger, MessageFlags } = deps;
  const operationJournal = createOperationJournalRuntime({
    OperationJournalModel: deps.OperationJournalModel,
    GuildModel,
    GuildAuditLogModel,
    logger
  });

  function operationKey(interaction: DiscordInteraction, kind: string, scope: string): string {
    return `${kind}:${interaction.guild?.id || "unknown"}:${interaction.id || `${interaction.user?.id || "unknown"}:${Date.now()}`}:${scope}`;
  }

  async function authorizeOwner(interaction: DiscordInteraction): Promise<DiscordInteraction | null> {
    if (await isGuildOwner(interaction)) return interaction;
    if (interaction.globalAccessCodeAuthorized === true) return interaction;
    return adminCommandRouterGuard.promptGlobalAccessCode({
      GuildModel,
      GuildAuditLogModel,
      adminAlert: deps.adminAlert
    }, interaction);
  }

  async function handleSet(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const role = interaction.options.getRole("role", true);
    const mode = normalizeMode(interaction.options.getString("mode", true));
    const scope = parseAdminScopeId(interaction.options.getString("command", false));
    if (!role?.id) return safeEdit(interaction, "Eroare: trebuie sa alegi un rol valid.");
    if (!mode) return safeEdit(interaction, "Eroare: mode accepta doar `role` sau `role-or-higher`.");
    if (!scope) {
      return safeEdit(interaction, `Eroare: ${displayAdminCommandAccessScope(readTargetScope(interaction))} nu este o comanda admin pe care o pot restrictiona, deci regula nu ar fi aplicata niciodata. Alege o comanda admin reala din autocomplete sau lasa \`command\` gol pentru regula globala.`);
    }
    const access = { mode, roleId: role.id, updatedBy: interaction.user?.id || "", updatedAt: new Date() };
    const legacyKeys = scope === "global" ? [] : buildAdminCommandAccessScopeLookupKeys(scope).filter(key => key !== scope);
    await operationJournal.runJournaled(operationKey(interaction, ADMIN_ACCESS_SAVE_KIND, scope), ADMIN_ACCESS_SAVE_KIND, {
      guildId,
      scope,
      access,
      legacyKeys,
      audit: {
        userId: interaction.user?.id || "",
        action: "admin_access_set",
        details: `${displayAdminCommandAccessScope(scope)}: ${labelMode(mode)} <@&${role.id}>`
      }
    }, {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      resourceKey: `admin-access:${guildId}:${scope}`,
      resourceVersion: journalResourceVersion(interaction.id)
    });
    return safeEdit(interaction, `OK: ${displayAdminCommandAccessScope(scope)} poate fi folosita de Administrator si de ${labelMode(mode)}: <@&${role.id}>.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const scope = readTargetScope(interaction);
    const doc = await loadAdminAccessDoc(GuildModel, guildId);
    if (scope !== "global") {
      return safeEdit(interaction, formatScopedAccess(doc, scope));
    }
    return sendPaginatedEditFlags(interaction, payload => safeEdit(interaction, payload), MessageFlags.Ephemeral, formatAccessList(doc).split("\n"));
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const scope = readTargetScope(interaction);
    if (interaction.options.getBoolean("confirm", true) !== true) {
      return safeEdit(interaction, "Stergerea a fost anulata. Foloseste `confirm:true` numai daca vrei sa revii la accesul implicit.");
    }
    await operationJournal.runJournaled(operationKey(interaction, ADMIN_ACCESS_DELETE_KIND, scope), ADMIN_ACCESS_DELETE_KIND, {
      guildId,
      scope,
      lookupKeys: buildAdminCommandAccessScopeLookupKeys(scope),
      audit: {
        userId: interaction.user?.id || "",
        action: "admin_access_delete",
        details: displayAdminCommandAccessScope(scope)
      }
    }, {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      resourceKey: `admin-access:${guildId}:${scope}`,
      resourceVersion: journalResourceVersion(interaction.id)
    });
    return safeEdit(interaction, `OK: regula de rol pentru ${displayAdminCommandAccessScope(scope)} a fost stearsa. Ramane accesul implicit: Administrator sau cod global de acces.`);
  }

  async function handleAdminCommandAccess(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const authorizedInteraction = await authorizeOwner(interaction);
    if (!authorizedInteraction) return handledCommandError("owner-only-admin-command-access");
    await safeDefer(authorizedInteraction, true);
    const subcommand = authorizedInteraction.options.getSubcommand(false);
    if (authorizedInteraction.commandName === "set" && subcommand === "admin-command-access") return handleSet(authorizedInteraction, guildId);
    if (authorizedInteraction.commandName === "delete" && subcommand === "admin-command-access") return handleDelete(authorizedInteraction, guildId);
    if (authorizedInteraction.commandName === "admin-command-access" && subcommand === "list") return handleList(authorizedInteraction, guildId);
    return safeEdit(authorizedInteraction, "Eroare: subcomanda de acces admin nu este recunoscuta.");
  }

  return { handleAdminCommandAccess };
}

function isAdminCommandAccessCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  if (interaction.commandName === "admin-command-access") return true;
  if (interaction.commandName === "set") return interaction.options.getSubcommand(false) === "admin-command-access";
  if (interaction.commandName === "delete") return interaction.options.getSubcommand(false) === "admin-command-access";
  return false;
}

function buildAdminCommandAccessCommandHandler(target: AdminCommandAccessContext) {
  const handlers = createAdminCommandAccessHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isAdminCommandAccessCommand(interaction as DiscordInteraction),
    handle: async interaction => {
      try {
        return await handlers.handleAdminCommandAccess(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "ADMIN_COMMAND_ACCESS", "Eroare la configurarea accesului admin", errorDetail(err));
        const payload = { content: "Eroare: nu am putut actualiza accesul pentru comenzile admin.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createAdminCommandAccessHandler,
  buildCommandHandler: buildAdminCommandAccessCommandHandler
};
