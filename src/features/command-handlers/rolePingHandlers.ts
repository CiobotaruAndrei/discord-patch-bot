"use strict";

import { applyGuildConfigUpdate } from "../guild-config/guildConfigRepository.js";
import type { DiscordReplyPayload, GameConfig, MongoWriteOutcome } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";

import { errorDetail } from "../../shared/errors.js";

type MaybePromise<T> = T | Promise<T>;

type InteractionPayload = DiscordReplyPayload;
type MongoWriteResult = MongoWriteOutcome;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type DiscordRole = { id: string };

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getSubcommandGroup?(required: false): string | null;
    getRole(name: string, required?: boolean): DiscordRole | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

type RolePingInteractionDeps = {
  GuildModel: {
    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteResult>;
  };
  logger?: Logger;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string) => string;
  MessageFlags: { Ephemeral: number };
};

type RolePingContext = RolePingInteractionDeps;

const KNOWN_ROLE_SUBS: Record<string, { field: string; label: string }> = {
  updates: { field: "notificationRoleId", label: "update-uri" },
  discounts: { field: "discountRoleId", label: "reduceri" }
};

function createRolePingInteractionHandlers(deps: RolePingInteractionDeps) {
  const { GuildModel, safeDefer, safeEdit, formatUserError, logger } = deps;

  async function handleSetRole(interaction: DiscordInteraction, sub: string, guildId: string) {
    const knownSub = KNOWN_ROLE_SUBS[sub];
    if (!knownSub) {
      logger?.("WARN", "SET_ROLE", `Subcomanda /set role necunoscuta: ${sub}`);
      return safeEdit(interaction, `Eroare: Subcomanda \`/set role ${sub}\` nu este recunoscuta.`);
    }
    const role = interaction.options.getRole("value", false);
    const { field, label } = knownSub;
    try {
      if (role) {
        await applyGuildConfigUpdate(GuildModel, guildId, { [field]: role.id });
        return safeEdit(interaction, `OK: Rol pentru ${label}: <@&${role.id}> *(ping doar la prima notificare per ciclu)*`);
      }

      await applyGuildConfigUpdate(GuildModel, guildId, { [field]: null }, { upsert: false });
      return safeEdit(interaction, `OK: Rol pentru ${label} eliminat (fara ping).`);
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la setarea rolului."));
    }
  }

  async function handleSetRoleInteraction(interaction: DiscordInteraction) {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction, true);
    return handleSetRole(interaction, sub, guildId);
  }

  return { handleSetRole, handleSetRoleInteraction };
}

function isSetRoleCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["set"], group: "role" });
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildRolePingCommandHandler(target: RolePingContext) {
  const handlers = createRolePingInteractionHandlers({
    GuildModel: target.GuildModel,
    logger: target.logger,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    formatUserError: target.formatUserError,
    MessageFlags: target.MessageFlags
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => Boolean(isSetRoleCommand(interaction as DiscordInteraction)),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleSetRoleInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "ROLE_PING_INTERACTION", "Eroare in handler-ul /set role", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") await di.followUp(payload);
          else if (typeof di.reply === "function") await di.reply(payload);
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default { createRolePingInteractionHandlers, buildCommandHandler: buildRolePingCommandHandler };
