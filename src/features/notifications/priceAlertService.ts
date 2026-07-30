"use strict";

import type { MongoWriteOutcome, PriceValue } from "../../types.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { PriceAlertRule } from "./notificationTypes.js";
import type { DealInfo } from "../../sources/sourceTypes.js";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "./outboundChannel.js";
import { rollbackOrReport, type ReportRollbackFailure } from "./rollbackReporter.js";
import { matchedDocument } from "../../shared/persistenceOutcome.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type MongoWriteResult = MongoWriteOutcome;

interface GuildModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
}

type ResolveOutboundChannel = (options: {
  client: NotificationDiscordClient;
  guild: GuildSettings;
  channelId: string | null | undefined;
  context: string;
  disableFn: (guildId: string, channelId: string, message: string) => Promise<MongoWriteResult>;
}) => Promise<ResolveOutboundChannelResult>;

export interface PriceAlertServiceDeps {
  GuildModel: GuildModelLike;
  logger: Logger;
  resolveOutboundChannel: ResolveOutboundChannel;
  disableDiscountsForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
  rollbackTriggeredAlert(guildId: string, alert: PriceAlertRule): Promise<MongoWriteResult>;
  formatPrice(value: PriceValue, currencyCode?: string | null): string;
  sleepIfPositive(ms: number): Promise<void>;
  DISCORD_SEND_DELAY_MS: number;
  rearmAbsentCycles: number;
  reportRollbackFailure?: ReportRollbackFailure;
}

interface TriggeredPriceAlert {
  alert: PriceAlertRule;
  deal: DealInfo;
  price: number;
  triggeredAt: Date;
  embed: Record<string, unknown>;
}

function normalizeMatchValue(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numericPrice(value: PriceValue | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".").replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dealMatchesPriceAlert(deal: DealInfo, alert: PriceAlertRule): boolean {
  const alertAppId = String(alert.appId || "").trim();
  const dealAppId = String(deal.appId || deal.steamAppID || "").trim();
  if (alertAppId && dealAppId && alertAppId === dealAppId) return true;
  const title = normalizeMatchValue(deal.title);
  if (!title) return false;
  const terms = [alert.gameName, alert.gameKey, ...(alert.aliases || [])]
    .map(normalizeMatchValue)
    .filter(term => term.length >= 3);
  return terms.some(term => title === term || title.startsWith(`${term} `));
}

function cheapestMatchingDeal(deals: DealInfo[], alert: PriceAlertRule): { deal: DealInfo; price: number } | null {
  let selected: { deal: DealInfo; price: number } | null = null;
  for (const deal of deals) {
    if (!dealMatchesPriceAlert(deal, alert)) continue;
    const price = numericPrice(deal.salePrice);
    if (price === null) continue;
    if (!selected || price < selected.price) selected = { deal, price };
  }
  return selected;
}

function buildPriceAlertEmbed(
  alert: PriceAlertRule,
  deal: DealInfo,
  price: number,
  formatPrice: PriceAlertServiceDeps["formatPrice"]
): Record<string, unknown> {
  const link = String(deal.url || deal.link || "");
  const store = String(deal.store || "magazin necunoscut");
  const embed: Record<string, unknown> = {
    title: `Alerta de pret: ${alert.gameName}`,
    description: `Pretul a ajuns la **${formatPrice(price, alert.currency)}**, sub pragul configurat de **${formatPrice(alert.threshold, alert.currency)}**.`,
    color: 0x2ecc71,
    fields: [
      { name: "Magazin", value: store, inline: true },
      { name: "Comanda", value: `/remove price-alert joc:${alert.gameKey}`, inline: false }
    ],
    timestamp: new Date().toISOString()
  };
  if (link) embed.url = link;
  const image = deal.image || deal.thumbnail;
  if (typeof image === "string" && image) embed.thumbnail = { url: image };
  return embed;
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function createPriceAlertService(deps: PriceAlertServiceDeps) {
  const {
    GuildModel, logger, resolveOutboundChannel, disableDiscountsForChannelError,
    rollbackTriggeredAlert, formatPrice, sleepIfPositive, DISCORD_SEND_DELAY_MS, rearmAbsentCycles,
    reportRollbackFailure
  } = deps;

  const rearmThreshold = Math.max(1, Math.floor(rearmAbsentCycles) || 1);

  async function updateObservedPrice(guildId: string, alert: PriceAlertRule, price: number, rearm: boolean): Promise<void> {
    const setDoc: Record<string, unknown> = {
      "priceAlerts.$[alert].lastObservedPrice": price,
      "priceAlerts.$[alert].lastObservedAt": new Date(),
      "priceAlerts.$[alert].absentCycles": 0
    };
    if (rearm) setDoc["priceAlerts.$[alert].triggeredAt"] = null;
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: setDoc },
      { arrayFilters: [{ "alert.gameKey": alert.gameKey, "alert.currency": alert.currency }] }
    );
  }

  async function registerAbsentObservation(guildId: string, alert: PriceAlertRule, nextAbsent: number): Promise<void> {
    const rearm = nextAbsent >= rearmThreshold;
    const setDoc: Record<string, unknown> = {
      "priceAlerts.$[alert].absentCycles": rearm ? 0 : nextAbsent
    };
    if (rearm) setDoc["priceAlerts.$[alert].triggeredAt"] = null;
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: setDoc },
      { arrayFilters: [{ "alert.gameKey": alert.gameKey, "alert.currency": alert.currency }] }
    );
    if (rearm) {
      logger("INFO", "PRICE_ALERT", `Alerta de pret rearmata (jocul ${alert.gameKey} a lipsit ${nextAbsent} cicluri din feed-ul de reduceri) pentru guild ${guildId}`);
    }
  }

  async function claimTrigger(guildId: string, alert: PriceAlertRule, price: number): Promise<Date | null> {
    const triggeredAt = new Date();
    const result = await GuildModel.updateOne(
      {
        _id: guildId,
        priceAlerts: {
          $elemMatch: {
            gameKey: alert.gameKey,
            currency: alert.currency,
            triggeredAt: null
          }
        }
      },
      {
        $set: {
          "priceAlerts.$.triggeredAt": triggeredAt,
          "priceAlerts.$.lastObservedPrice": price,
          "priceAlerts.$.lastObservedAt": triggeredAt,
          "priceAlerts.$.absentCycles": 0
        }
      }
    );
    return matchedDocument(result) ? triggeredAt : null;
  }

  async function processGuildPriceAlerts(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    dealsByCurrency: ReadonlyMap<string, DealInfo[]>
  ): Promise<void> {
    const alerts = Array.isArray(guild.priceAlerts) ? guild.priceAlerts : [];
    if (!alerts.length) return;
    const guildId = String(guild._id);
    const triggered: TriggeredPriceAlert[] = [];
    for (const alert of alerts) {
      const currency = String(alert.currency || "").toUpperCase();
      const deals = dealsByCurrency.get(currency);
      if (!deals) continue;
      const selected = cheapestMatchingDeal(deals, alert);
      if (!selected) {
        if (alert.triggeredAt) {
          await registerAbsentObservation(guildId, alert, (Number(alert.absentCycles) || 0) + 1);
        }
        continue;
      }
      if (selected.price > alert.threshold) {
        await updateObservedPrice(guildId, alert, selected.price, Boolean(alert.triggeredAt));
        continue;
      }
      if (alert.triggeredAt) {
        await updateObservedPrice(guildId, alert, selected.price, false);
        continue;
      }
      const triggeredAt = await claimTrigger(guildId, alert, selected.price);
      if (!triggeredAt) continue;
      triggered.push({
        alert,
        deal: selected.deal,
        price: selected.price,
        triggeredAt,
        embed: buildPriceAlertEmbed(alert, selected.deal, selected.price, formatPrice)
      });
    }
    if (!triggered.length) return;
    const resolved = await resolveOutboundChannel({
      client,
      guild,
      channelId: guild.discountChannelId,
      context: "CRON_DISCOUNTS",
      disableFn: disableDiscountsForChannelError
    });
    if (resolved.abort) {
      for (const item of triggered) await rollbackOrReport(() => rollbackTriggeredAlert(guildId, item.alert), logger, { guildId, kind: "price-alert", itemId: `${item.alert.gameKey}:${item.alert.currency}` }, reportRollbackFailure);
      return;
    }
    const chunks = splitIntoChunks(triggered, 10);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const payload: Record<string, unknown> = { embeds: chunk.map(item => item.embed) };
      if (index === 0 && guild.discountRoleId) {
        payload.content = `<@&${guild.discountRoleId}>`;
        payload.allowedMentions = { roles: [guild.discountRoleId] };
      }
      try {
        await resolved.channel.send(payload, {
          historyEntries: chunk.map(item => ({
            kind: "discount" as const,
            title: `Alerta pret: ${item.alert.gameName}`,
            link: String(item.deal.url || item.deal.link || ""),
            itemId: `price-alert:${item.alert.gameKey}:${item.alert.currency}:${item.price}:${item.triggeredAt.getTime()}`
          }))
        });
        await sleepIfPositive(DISCORD_SEND_DELAY_MS);
      } catch (err: unknown) {
        const failed = chunks.slice(index).flat();
        for (const item of failed) await rollbackOrReport(() => rollbackTriggeredAlert(guildId, item.alert), logger, { guildId, kind: "price-alert", itemId: `${item.alert.gameKey}:${item.alert.currency}` }, reportRollbackFailure);
        logger("WARN", "PRICE_ALERT", `Trimiterea alertelor de pret a esuat pentru guild ${guildId}`, err);
        break;
      }
    }
  }

  return { processGuildPriceAlerts, claimTrigger, updateObservedPrice };
}

export { normalizeMatchValue, numericPrice, dealMatchesPriceAlert, cheapestMatchingDeal, buildPriceAlertEmbed };
