"use strict";

import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts";

export function createDlcSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { GuildModel, invalidateGuildCache, OP_UPDATE_OPTS, safeEdit, makeActivationId, formatUserError } = deps;

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel) {
    try {
      const activationId = makeActivationId();
      await GuildModel.updateOne(
        { _id: guildId },
        {
          $set: {
            dlcSubscribed: true,
            dlcChannelId: channel.id,
            dlcInitializing: false,
            dlcActivationId: activationId
          }
        },
        { upsert: true, ...OP_UPDATE_OPTS }
      );
      invalidateGuildCache(guildId);
      return safeEdit(interaction, "OK: canalul pentru notificarile DLC a fost configurat. Motorul automat DLC foloseste lista jocurilor active cand este activ in runtime.");
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la configurarea notificarilor DLC."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await GuildModel.updateOne({ _id: guildId }, {
      $set: { dlcSubscribed: false, dlcChannelId: null, dlcInitializing: false },
      $unset: { dlcActivationId: "" }
    }, OP_UPDATE_OPTS);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, "OK: Notificarile DLC au fost oprite.");
  }

  return { start, stop };
}
