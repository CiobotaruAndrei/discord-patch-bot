"use strict";

import type { InteractionMessage } from "../../types.js";
import type { CommandLogEnd, DeferEditInteraction, LoggableInteraction, PresentationLogger } from "./presentationContracts.js";
import { errorMessage } from "../../shared/errors.js";
import type { DiscordGateway } from "../discord/discordGateway.js";

export interface InteractionReplyHelpersDeps {
  logger: PresentationLogger;
  checkUserCooldown(userId: unknown, command: string): { allowed: boolean; remainingMs?: number };
  MessageFlags: { Ephemeral: number };
  discordGateway?: DiscordGateway;
}

export function createInteractionReplyHelpers({ logger, checkUserCooldown, MessageFlags, discordGateway }: InteractionReplyHelpersDeps) {
  async function enforceCooldown(interaction: DeferEditInteraction, command: string): Promise<boolean> {
    const { allowed, remainingMs = 0 } = checkUserCooldown(interaction.user?.id, command);
    if (allowed) return true;
    const msg = `Cooldown: Comanda \`${command}\` are cooldown. Reincearca in **${Math.ceil(remainingMs / 1000)}s**.`;
    if (interaction.deferred || interaction.replied) await (discordGateway ? discordGateway.edit(interaction, msg) : interaction.editReply?.(msg))?.catch(() => null);
    else await (discordGateway ? discordGateway.reply(interaction, msg, { ephemeral: true }) : interaction.reply?.({ content: msg, flags: MessageFlags.Ephemeral }))?.catch(() => null);
    return false;
  }

  function startCommandLog(interaction: LoggableInteraction, command: string, extra: Record<string, unknown> = {}): CommandLogEnd {
    const startedAt = Date.now();
    logger("INFO", "USER_CMD", `Comanda pornita: ${command}`, {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id,
      command,
      ...extra
    });
    return (status = "ok", endExtra: Record<string, unknown> = {}) => {
      logger("INFO", "USER_CMD", `Comanda finalizata: ${command} [${status}]`, {
        userId: interaction.user?.id,
        guildId: interaction.guild?.id,
        command,
        status,
        durationMs: Date.now() - startedAt,
        ...endExtra
      });
    };
  }

  async function safeDefer(interaction: DeferEditInteraction, ephemeral = false): Promise<void> {
    try {
      if (!interaction.deferred && !interaction.replied) {
        if (discordGateway) await discordGateway.defer(interaction, { ephemeral });
        else await interaction.deferReply?.(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      }
    } catch (err) {
      logger("WARN", "INTERACTION", "Eroare la deferReply", errorMessage(err));
    }
  }

  async function safeEdit(interaction: DeferEditInteraction, payload: unknown): Promise<InteractionMessage | null> {
    try { return ((await (discordGateway ? discordGateway.edit(interaction, payload) : interaction.editReply?.(payload))) as InteractionMessage | null) ?? null; }
    catch (err) {
      logger("WARN", "INTERACTION", "Eroare la editReply", errorMessage(err));
      try {
        const fallback = { content: "Eroare: nu am putut afisa raspunsul (prea lung sau eroare temporara). Reincearca sau restrange filtrele.", flags: MessageFlags.Ephemeral };
        if (discordGateway) await discordGateway.followUp(interaction, fallback, { ephemeral: true });
        else await interaction.followUp?.(fallback);
      } catch (followErr) {
        logger("WARN", "INTERACTION", "Eroare la followUp-ul de fallback dupa editReply esuat", errorMessage(followErr));
      }
      return null;
    }
  }

  return { enforceCooldown, startCommandLog, safeDefer, safeEdit };
}
