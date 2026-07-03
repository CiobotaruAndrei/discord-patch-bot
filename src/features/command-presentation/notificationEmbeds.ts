"use strict";

import type { DealInfo, EmbeddableUpdate, NotificationMode } from "../../types";
import type { ChainableEmbed } from "./presentationContracts";

export interface NotificationEmbedsDeps {
  EmbedBuilder: new () => ChainableEmbed;
  COLORS: Record<string, number>;
  truncate(value: unknown, maxLen: number): string;
  DEFAULT_CURRENCY: string;
  formatPrice(value: unknown, currencyCode?: string): string;
}

export function createNotificationEmbeds({ EmbedBuilder, COLORS, truncate, DEFAULT_CURRENCY, formatPrice }: NotificationEmbedsDeps) {
  function buildUpdateEmbed(gameName: string, latest: EmbeddableUpdate, mode: NotificationMode = "detailed"): ChainableEmbed {
    const isCompact = mode === "compact";
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(truncate(latest.title, 256))
      .setFooter({ text: truncate(gameName, 2048) });
    if (latest.link) embed.setURL(latest.link);
    if (isCompact) {
      embed.setDescription(latest.link ? "Apasa pe titlu pentru a citi patch-ul." : `A aparut un nou update pentru ${gameName}.`);
    } else {
      embed.setDescription(truncate(latest.excerpt || `A aparut un nou update pentru ${gameName}.`, 4096));
      if (latest.image) embed.setImage(latest.image);
      if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
      if (latest.timestamp) {
        const d = new Date(latest.timestamp);
        if (!Number.isNaN(d.getTime())) embed.setTimestamp(d);
      }
    }
    return embed;
  }

  function buildDealEmbed(deal: DealInfo, mode: NotificationMode = "detailed", currency?: string): ChainableEmbed {
    const cur = currency || deal.currency || DEFAULT_CURRENCY;
    const isFree = parseFloat(String(deal.salePrice)) === 0;
    const isCompact = mode === "compact";
    const embed = new EmbedBuilder()
      .setColor(isFree ? COLORS.FREE : COLORS.ERROR)
      .setTitle(truncate(`${isFree ? "Gratuit: " : "Reducere: "}${deal.title}`, 256));
    if (deal.link) embed.setURL(deal.link);
    if (isCompact) {
      embed.setDescription(`**${deal.store}** | ~~${formatPrice(deal.normalPrice, String(cur))}~~ -> **${isFree ? "GRATUIT" : formatPrice(deal.salePrice, String(cur))}**\n[Apasa aici pentru link](${deal.link})`);
      return embed;
    }

    const qualityNum = Number(deal.qualityScore);
    const reviewsNum = Number(deal.totalReviews);
    const savingsNum = Number(deal.savings);
    const savingsDisplay = Number.isFinite(savingsNum) ? Math.min(100, Math.max(0, Math.round(savingsNum))) : 0;
    let statsStr = "";
    if (Number.isFinite(qualityNum) && qualityNum > 0) {
      const popularity = Number.isFinite(reviewsNum) && reviewsNum > 0 ? `${reviewsNum} recenzii` : "Top Seller";
      statsStr = `**Calitate:** ${Math.round(qualityNum)}% aprecieri | **Popularitate:** ${popularity}\n\n`;
    }
    embed.setAuthor({ name: truncate(deal.store, 256) })
      .setDescription(truncate(`**${deal.store}** ofera o reducere de **${savingsDisplay}%**!\n\n`
        + statsStr + (deal.endDateStr && deal.endDateStr !== "Nespecificat"
          ? `**${isFree ? "Gratis pana la" : "Expira la"}:** ${deal.endDateStr}\n\n`
          : ""), 4096))
      .addFields(
        { name: "Pret Vechi", value: `~~${formatPrice(deal.normalPrice, String(cur))}~~`, inline: true },
        { name: "Pret Nou", value: isFree ? "GRATUIT" : formatPrice(deal.salePrice, String(cur)), inline: true },
        { name: "Link", value: `[Apasa aici](${deal.link})`, inline: false }
      );
    if (typeof deal.thumbnail === "string" && deal.thumbnail.startsWith("http")) embed.setThumbnail(deal.thumbnail);
    if (deal.extraDetails) embed.addFields({ name: "Detalii", value: truncate(deal.extraDetails.trim(), 1024), inline: false });
    return embed;
  }

  return { buildUpdateEmbed, buildDealEmbed };
}
