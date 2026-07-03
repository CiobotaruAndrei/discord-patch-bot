"use strict";

import type { InteractionMessage } from "../../types";
import type { CommandLogEnd, DeferEditInteraction, LoggableInteraction, PresentationLogger } from "./presentationContracts";
import { errorMessage } from "../../shared/errors";

export interface InteractionReplyHelpersDeps {
  logger: PresentationLogger;
  checkUserCooldown(userId: unknown, command: string): { allowed: boolean; remainingMs?: number };
  MessageFlags: { Ephemeral: number };
}

export function createInteractionReplyHelpers({ logger, checkUserCooldown, MessageFlags }: InteractionReplyHelpersDeps) {
  async function enforceCooldown(interaction: DeferEditInteraction, command: string): Promise<boolean> {
    const { allowed, remainingMs = 0 } = checkUserCooldown(interaction.user?.id, command);
    if (allowed) return true;
    const msg = `Cooldown: Comanda \`${command}\` are cooldown. Reincearca in **${Math.ceil(remainingMs / 1000)}s**.`;
    if (interaction.deferred || interaction.replied) await interaction.editReply?.(msg)?.catch(() => null);
    else await interaction.reply?.({ content: msg, flags: MessageFlags.Ephemeral })?.catch(() => null);
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
        await interaction.deferReply?.(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      }
    } catch (err) {
      logger("WARN", "INTERACTION", "Eroare la deferReply", errorMessage(err));
    }
  }

  async function safeEdit(interaction: DeferEditInteraction, payload: unknown): Promise<InteractionMessage | null> {
    try { return (await interaction.editReply?.(payload)) ?? null; }
    catch (err) {
      logger("WARN", "INTERACTION", "Eroare la editReply", errorMessage(err));
      try {
        await interaction.followUp?.({
          content: "Eroare: nu am putut afisa raspunsul (prea lung sau eroare temporara). Reincearca sau restrange filtrele.",
          flags: MessageFlags.Ephemeral
        });
      } catch (followErr) {
        logger("WARN", "INTERACTION", "Eroare la followUp-ul de fallback dupa editReply esuat", errorMessage(followErr));
      }
      return null;
    }
  }

  return { enforceCooldown, startCommandLog, safeDefer, safeEdit };
}
