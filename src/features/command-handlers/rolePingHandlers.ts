"use strict";

import type { GameConfig } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;

type InteractionPayload = string | Record<string, unknown>;
type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
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
  invalidateGuildCache: (guildId: string) => void;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string) => string;
  MessageFlags: { Ephemeral: number };
};

type RolePingContext = RolePingInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
};

const KNOWN_ROLE_SUBS: Record<string, { field: string; label: string }> = {
  updates: { field: "notificationRoleId", label: "update-uri" },
  discounts: { field: "discountRoleId", label: "reduceri" }
};

function createRolePingInteractionHandlers(deps: RolePingInteractionDeps) {
  const { GuildModel, invalidateGuildCache, safeDefer, safeEdit, formatUserError, logger } = deps;

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
        await GuildModel.updateOne({ _id: guildId }, { $set: { [field]: role.id } }, { upsert: true });
        invalidateGuildCache(guildId);
        return safeEdit(interaction, `OK: Rol pentru ${label}: <@&${role.id}> *(ping doar la prima notificare per ciclu)*`);
      }

      await GuildModel.updateOne({ _id: guildId }, { $set: { [field]: null } });
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: Rol pentru ${label} eliminat (fara ping).`);
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la setarea rolului."));
    }
  }

  async function handleSetRoleInteraction(interaction: DiscordInteraction) {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction);
    return handleSetRole(interaction, sub, guildId);
  }

  return { handleSetRole, handleSetRoleInteraction };
}

function isSetRoleCommand(interaction: DiscordInteraction) {
  return interaction?.isChatInputCommand?.() === true
    && interaction.guild
    && interaction.commandName === "set"
    && interaction.options?.getSubcommandGroup?.(false) === "role";
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
    invalidateGuildCache: target.invalidateGuildCache,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    formatUserError: target.formatUserError,
    MessageFlags: target.MessageFlags
  });

  const command: CommandHandler = {
    canHandle: (interaction) => Boolean(isSetRoleCommand(interaction as DiscordInteraction)),
    handle: async (interaction) => {
      const di = interaction as DiscordInteraction;
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

function installRolePingInteractions(target: RolePingContext) {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildRolePingCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

Object.assign(installRolePingInteractions, { createRolePingInteractionHandlers, buildCommandHandler: buildRolePingCommandHandler });

export = installRolePingInteractions;
