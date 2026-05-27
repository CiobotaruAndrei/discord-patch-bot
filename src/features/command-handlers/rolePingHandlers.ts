"use strict";

const { errorDetail } = require("../../shared/errors");

type DiscordInteraction = any;
type GameConfig = { key: string; name: string } & Record<string, any>;
type MaybePromise<T> = T | Promise<T>;

type RolePingInteractionDeps = {
  GuildModel: {
    updateOne: (...args: any[]) => Promise<any>;
  };
  logger?: (...args: any[]) => void;
  invalidateGuildCache: (guildId: string) => void;
  safeDefer: (interaction: DiscordInteraction) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: any) => Promise<any>;
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
    } catch (err: any) {
      return safeEdit(interaction, formatUserError(err, "Eroare la setarea rolului."));
    }
  }

  async function handleSetRoleInteraction(interaction: DiscordInteraction) {
    const guildId = interaction.guild.id;
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

function installRolePingInteractions(ctx: RolePingContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createRolePingInteractionHandlers(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isSetRoleCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    try {
      return await handlers.handleSetRoleInteraction(interaction);
    } catch (err: any) {
      ctx.logger?.("ERROR", "ROLE_PING_INTERACTION", "Eroare in handler-ul /set role", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installRolePingInteractions, { createRolePingInteractionHandlers });

export = installRolePingInteractions;
