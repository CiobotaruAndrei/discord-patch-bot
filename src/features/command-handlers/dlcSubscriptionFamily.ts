"use strict";

import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createSubscriptionService } from "../notifications/subscriptionService.js";

export function createDlcSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { safeEdit, formatUserError } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel) {
    try {
      const outcome = await service.startDlc(guildId, channel.id, async () => {
        if (deps.seedBaselineDlc) await deps.seedBaselineDlc(guildId);
      });
      if (outcome.status === "superseded") {
        return safeEdit(interaction, "Activarea DLC a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start dlc daca mai vrei activarea.");
      }
      if (outcome.status === "baseline-failed") {
        return safeEdit(interaction, formatUserError(outcome.error, "Nu am activat notificarile DLC fiindca baseline-ul initial nu a putut fi incarcat."));
      }
      return safeEdit(interaction, "OK: notificarile DLC au fost activate. Motorul automat DLC foloseste lista jocurilor active cand este activ in runtime.");
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la configurarea notificarilor DLC."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await service.stopDlc(guildId);
    return safeEdit(interaction, "OK: Notificarile DLC au fost oprite.");
  }

  return { start, stop };
}
