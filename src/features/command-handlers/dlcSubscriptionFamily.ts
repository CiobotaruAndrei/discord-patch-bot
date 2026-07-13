"use strict";

import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createSubscriptionService } from "../notifications/subscriptionService.js";

export function createDlcSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { safeEdit, formatUserError } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel) {
    try {
      await service.startDlc(guildId, channel.id);
      return safeEdit(interaction, "OK: canalul pentru notificarile DLC a fost configurat. Motorul automat DLC foloseste lista jocurilor active cand este activ in runtime.");
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
