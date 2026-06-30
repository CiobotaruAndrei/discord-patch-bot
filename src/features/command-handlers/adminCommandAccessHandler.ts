"use strict";

import type { CommandGame, CommandHandler } from "../command-registry/commandHandler";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | { content: string; flags?: number };
type AdminAccessMode = "role" | "role-or-higher";

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

type DiscordInteraction = {
  commandName?: string;
  guild?: DiscordGuild | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(required?: boolean): string;
    getRole(name: string, required?: boolean): DiscordRole | null;
    getString(name: string, required?: boolean): string | null;
    getBoolean(name: string, required?: boolean): boolean | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
};

type GuildAdminAccessDoc = {
  adminCommandAccess?: {
    mode?: AdminAccessMode | null;
    roleId?: string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  } | null;
};

type GuildFindQuery = {
  lean(): Promise<GuildAdminAccessDoc | null>;
};

type GuildModelLike = {
  updateOne(filter: object, update: object, options?: object): Promise<unknown>;
  findOne(filter: object): GuildFindQuery | Promise<GuildAdminAccessDoc | null>;
};

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type AdminCommandAccessDeps = {
  GuildModel: GuildModelLike;
  invalidateGuildCache(guildId: string): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
};

type AdminCommandAccessContext = AdminCommandAccessDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: CommandGame[]) => Promise<unknown> | unknown;
};

function hasLean(result: GuildFindQuery | Promise<GuildAdminAccessDoc | null>): result is GuildFindQuery {
  return "lean" in result && typeof result.lean === "function";
}

async function loadAdminCommandAccess(GuildModel: GuildModelLike, guildId: string): Promise<GuildAdminAccessDoc["adminCommandAccess"]> {
  const result = GuildModel.findOne({ _id: guildId });
  const doc = hasLean(result) ? await result.lean() : await result;
  return doc?.adminCommandAccess || null;
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

function labelMode(mode: string | null | undefined): string {
  return mode === "role-or-higher" ? "rol sau rol mai mare" : "rol exact";
}

function formatCurrentAccess(access: GuildAdminAccessDoc["adminCommandAccess"]): string {
  if (!access?.roleId || !access.mode) {
    return "Acces admin: implicit. Pana ownerul seteaza o regula de rol, comenzile admin raman disponibile doar pentru utilizatorii cu `Administrator`.";
  }
  const updatedAt = access.updatedAt ? `\nActualizat la: ${String(access.updatedAt)}` : "";
  const updatedBy = access.updatedBy ? `\nActualizat de: <@${access.updatedBy}>` : "";
  return `Acces admin configurat: ${labelMode(access.mode)} pentru <@&${access.roleId}>.${updatedBy}${updatedAt}`;
}

function normalizeMode(value: string | null): AdminAccessMode | null {
  if (value === "role" || value === "role-or-higher") return value;
  if (value === "exact") return "role";
  if (value === "or-higher") return "role-or-higher";
  return null;
}

function createAdminCommandAccessHandler(deps: AdminCommandAccessDeps) {
  const { GuildModel, invalidateGuildCache, safeDefer, safeEdit, logger } = deps;

  async function requireOwner(interaction: DiscordInteraction): Promise<boolean> {
    if (await isGuildOwner(interaction)) return true;
    await safeEdit(interaction, { content: "Access denied. Doar ownerul serverului poate modifica regulile de acces admin.", flags: deps.MessageFlags.Ephemeral });
    return false;
  }

  async function handleSet(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const role = interaction.options.getRole("role", true);
    const mode = normalizeMode(interaction.options.getString("mode", true));
    if (!role?.id) return safeEdit(interaction, "Eroare: trebuie sa alegi un rol valid.");
    if (!mode) return safeEdit(interaction, "Eroare: mode accepta doar `role` sau `role-or-higher`.");
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: { adminCommandAccess: { mode, roleId: role.id, updatedBy: interaction.user?.id || "", updatedAt: new Date() } } },
      { upsert: true }
    );
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: comenzile admin pot fi folosite de Administrator si de ${labelMode(mode)}: <@&${role.id}>.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const access = await loadAdminCommandAccess(GuildModel, guildId);
    return safeEdit(interaction, formatCurrentAccess(access));
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (interaction.options.getBoolean("confirm", true) !== true) {
      return safeEdit(interaction, "Stergerea a fost anulata. Foloseste `confirm:true` numai daca vrei sa revii la accesul implicit.");
    }
    await GuildModel.updateOne({ _id: guildId }, { $set: { adminCommandAccess: null } }, { upsert: true });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, "OK: regula de rol pentru comenzi admin a fost stearsa. Ramane accesul implicit: Administrator.");
  }

  async function handleAdminCommandAccess(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    if (!(await requireOwner(interaction))) return handledCommandError("owner-only-admin-command-access");
    const subcommand = interaction.options.getSubcommand(false);
    if (interaction.commandName === "set" && subcommand === "admin-command-access") return handleSet(interaction, guildId);
    if (interaction.commandName === "delete" && subcommand === "admin-command-access") return handleDelete(interaction, guildId);
    if (interaction.commandName === "admin-command-access" && subcommand === "list") return handleList(interaction, guildId);
    return safeEdit(interaction, "Eroare: subcomanda de acces admin nu este recunoscuta.");
  }

  return { handleAdminCommandAccess };
}

function isAdminCommandAccessCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  if (interaction.commandName === "admin-command-access") return true;
  if (interaction.commandName === "set") return interaction.options.getSubcommand(false) === "admin-command-access";
  if (interaction.commandName === "delete") return true;
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

const installAdminCommandAccessHandler = ((target: AdminCommandAccessContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildAdminCommandAccessCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: CommandGame[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: AdminCommandAccessContext) => void) & {
  createAdminCommandAccessHandler: typeof createAdminCommandAccessHandler;
  buildCommandHandler: typeof buildAdminCommandAccessCommandHandler;
};

installAdminCommandAccessHandler.createAdminCommandAccessHandler = createAdminCommandAccessHandler;
installAdminCommandAccessHandler.buildCommandHandler = buildAdminCommandAccessCommandHandler;

export = installAdminCommandAccessHandler;
