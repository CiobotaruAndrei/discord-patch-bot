"use strict";

import type { DiscordInteraction, YouTubeInteractionDeps } from "./youtubeCommandTypes";

import { errorDetail } from "../../../shared/errors";

export const YOUTUBE_MANUAL_IMMEDIATE_BATCH = 5;

export function createYouTubeManualVideoCommands(deps: YouTubeInteractionDeps) {
  const { getGuildSettings, prepareManualYouTubeVideos, deliverManualYouTubeVideos, safeEdit } = deps;

  async function showVideos(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const selectedChannelId = interaction.options.getString("canal", true);
    const force = interaction.options.getBoolean("repeta") === true;
    const settings = await getGuildSettings(guildId);
    if (!selectedChannelId || !settings?.youtubeChannels?.length) {
      return safeEdit(interaction, "Eroare: serverul nu are canale YouTube urmarite.");
    }
    if (selectedChannelId !== "toate" && !settings.youtubeChannels.some(channel => channel.channelId === selectedChannelId)) {
      return safeEdit(interaction, "Eroare: alege un canal YouTube urmarit sau valoarea `toate`.");
    }
    if (!interaction.client) return safeEdit(interaction, "Eroare: clientul Discord nu este disponibil.");
    const client = interaction.client;
    const { deliverable, skipped, claimed } = await prepareManualYouTubeVideos(settings, selectedChannelId, force);
    if (!deliverable.length && skipped === 0) {
      return safeEdit(interaction, force
        ? "Info: nu exista videoclipuri recente (din ultima luna) de afisat pentru aceasta selectie."
        : "Info: nu exista videoclipuri recente noi de afisat (cele din ultima luna au fost deja postate manual). Foloseste `repeta:true` ca sa le repostezi pe toate.");
    }
    if (!deliverable.length) {
      return safeEdit(interaction, "Eroare: niciun canal de destinatie configurat pentru aceste videoclipuri. Seteaza un canal cu `/youtube notify channel` sau adauga o ruta cu `/youtube add channel-route` inainte de afisarea manuala.");
    }
    const skippedNote = skipped > 0 ? ` (${skipped} sarite: canalul lor YouTube nu are nici ruta, nici canal principal de destinatie)` : "";
    const immediate = deliverable.slice(0, YOUTUBE_MANUAL_IMMEDIATE_BATCH);
    const remaining = deliverable.slice(YOUTUBE_MANUAL_IMMEDIATE_BATCH);
    const firstResult = await deliverManualYouTubeVideos(client, settings, { items: immediate, claimed }, true);
    if (!remaining.length) {
      return safeEdit(interaction, `OK: am postat ${firstResult.videos} videoclip(e) pe ${firstResult.destinations} canal(e)${skippedNote}.`);
    }
    const durable = deps.outboxEnabled === true;
    const restNote = durable
      ? `Restul de ${remaining.length} sunt programate prin outbox-ul durabil si livrate in loturi de cate ${YOUTUBE_MANUAL_IMMEDIATE_BATCH} la interval de 10 minute, ca sa supravietuiasca unui restart.`
      : `Restul de ${remaining.length} continua in fundal in loturi de cate ${YOUTUBE_MANUAL_IMMEDIATE_BATCH} la interval de 10 minute; outbox-ul e dezactivat (NOTIFICATION_OUTBOX_ENABLED=false), deci NU sunt durabile la restart. Daca botul reporneste inainte sa termine, acele videoclipuri raman marcate ca afisate dar pot sa nu fi fost trimise - reia comanda cu \`repeta:true\` ca sa le repostezi.`;
    await safeEdit(interaction, `OK: am postat imediat primele ${firstResult.videos} videoclip(e)${skippedNote}. ${restNote}`);
    void deliverManualYouTubeVideos(client, settings, { items: remaining, claimed }, !durable)
      .then(result => deps.logger(
        "INFO",
        "YOUTUBE_COMMAND",
        `Afisarea manuala YouTube (loturi suplimentare) pentru guild ${guildId}: ${result.videos} videoclipuri, ${result.batches} loturi, ${result.destinations} destinatii`
      ))
      .catch(error => deps.logger(
        "WARN",
        "YOUTUBE_COMMAND",
        `Afisarea manuala YouTube a esuat in fundal pentru guild ${guildId}`,
        errorDetail(error)
      ));
    return undefined;
  }

  return { showVideos };
}
