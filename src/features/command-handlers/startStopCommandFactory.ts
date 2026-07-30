"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";

type StartStopFactoryDeps = Pick<
  SubscriptionInteractionDeps,
  "logger" | "safeDefer" | "safeEdit" | "canSendEmbeds" | "listMissingChannelPerms" | "missingChannelPermsMessage" | "formatUserError"
>;

export function createStartStopHandlers(deps: StartStopFactoryDeps, families: Record<string, SubscriptionFamily>) {
  const { logger, safeDefer, safeEdit, canSendEmbeds, listMissingChannelPerms, missingChannelPermsMessage, formatUserError } = deps;

  async function handleStartInteraction(interaction: SubscriptionInteraction, games: GameConfig[]) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);

    const botId = interaction.client?.user?.id;
    if (!botId || !canSendEmbeds(interaction.channel, botId)) {
      return safeEdit(interaction, missingChannelPermsMessage(botId ? listMissingChannelPerms(interaction.channel, botId) : null));
    }
    if (!interaction.channel) {
      return safeEdit(interaction, missingChannelPermsMessage());
    }

    const family = families[sub];
    if (family) return family.start(interaction, guildId, interaction.channel, games);

    logger?.("WARN", "START_COMMAND", `Subcomanda /start necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`/start ${sub}\` nu este recunoscuta.`);
  }

  async function handleStopInteraction(interaction: SubscriptionInteraction, games: GameConfig[] = []) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);

    const family = families[sub];
    if (family) {
      try {
        return await family.stop(interaction, guildId, games);
      } catch (err: unknown) {
        return safeEdit(interaction, formatUserError(err, "Eroare la baza de date."));
      }
    }

    logger?.("WARN", "STOP_COMMAND", `Subcomanda /stop necunoscuta: ${sub}`);
    return safeEdit(interaction, `Eroare: Subcomanda \`/stop ${sub}\` nu este recunoscuta.`);
  }

  return { handleStartInteraction, handleStopInteraction };
}
