import test from "node:test";
import assert from "node:assert/strict";

import {
  cheapestMatchingDeal,
  createPriceAlertService,
  dealMatchesPriceAlert,
  numericPrice
} from "../../features/notifications/priceAlertService.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import type { PriceAlertRule } from "../../features/notifications/notificationTypes.js";
import { makeNotificationDiscordClient } from "../typedTestBuilders.js";

const alert: PriceAlertRule = {
  gameKey: "elden-ring",
  gameName: "Elden Ring",
  appId: "1245620",
  aliases: ["elden ring"],
  threshold: 30,
  currency: "EUR",
  triggeredAt: null
};

test("price alert matcher prefera appId si selecteaza cea mai ieftina oferta", () => {
  const deals = [
    { title: "Elden Ring", appId: "1245620", salePrice: "29.99", store: "Steam" },
    { title: "Elden Ring Deluxe Edition", salePrice: "24,50", store: "Epic Games" },
    { title: "Alta oferta", salePrice: 1 }
  ];
  assert.equal(dealMatchesPriceAlert(deals[0], alert), true);
  assert.equal(dealMatchesPriceAlert(deals[2], alert), false);
  assert.equal(numericPrice("EUR 24,50"), 24.5);
  assert.equal(cheapestMatchingDeal(deals, alert)?.price, 24.5);
});

function makeService(claimMatched = true, rearmAbsentCycles = 3) {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const sent: Array<Record<string, unknown>> = [];
  const sentMeta: unknown[] = [];
  const service = createPriceAlertService({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        updates.push({ filter, update, options });
        const serialized = JSON.stringify(filter);
        return serialized.includes("$elemMatch")
          ? { matchedCount: claimMatched ? 1 : 0, modifiedCount: claimMatched ? 1 : 0 }
          : { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "deals-channel",
        send: async (payload, meta) => { sent.push(payload as Record<string, unknown>); sentMeta.push(meta); return { id: "message-1" }; }
      }
    }),
    disableDiscountsForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    rollbackTriggeredAlert: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    formatPrice: (value, currency) => `${value} ${currency}`,
    sleepIfPositive: async () => undefined,
    DISCORD_SEND_DELAY_MS: 0,
    rearmAbsentCycles
  });
  return { service, updates, sent, sentMeta };
}

function guild(rule: PriceAlertRule): GuildSettings {
  return {
    _id: "guild-1",
    discountsSubscribed: true,
    discountChannelId: "deals-channel",
    priceAlerts: [rule]
  };
}

test("price alert service revendica atomic si trimite o singura alerta sub prag", async () => {
  const { service, updates, sent } = makeService(true);
  const deals = new Map([["EUR", [{
    id: "deal-1",
    title: "Elden Ring",
    appId: "1245620",
    salePrice: 25,
    store: "Steam",
    link: "https://example.com/elden-ring"
  }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(alert), deals);

  assert.equal(sent.length, 1);
  assert.match(JSON.stringify(sent[0]), /Alerta de pret: Elden Ring/);
  assert.ok(updates.some(call => JSON.stringify(call.filter).includes("$elemMatch")));
});

test("price alert: itemId-ul de history include momentul declansarii, ca re-armarile la acelasi pret sa nu fie deduplicate (R14 #3)", async () => {
  const { service, sentMeta } = makeService(true);
  const deals = new Map([["EUR", [{
    id: "deal-1", title: "Elden Ring", appId: "1245620", salePrice: 25, store: "Steam", link: "https://example.com/elden-ring"
  }]]]);
  const before = Date.now();
  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(alert), deals);
  const after = Date.now();

  const meta = sentMeta[0] as { historyEntries?: Array<{ itemId?: string }> } | undefined;
  const itemId = String(meta?.historyEntries?.[0]?.itemId || "");
  assert.match(itemId, /^price-alert:elden-ring:EUR:25:\d+$/, "itemId include sufixul cu momentul declansarii (gameKey:currency:price:triggeredAt)");
  const ts = Number(itemId.split(":").at(-1));
  assert.ok(ts >= before && ts <= after, "sufixul e timestamp-ul real al declansarii, deci doua re-armari la acelasi pret produc itemId-uri diferite (history nu le mai deduplica)");
});

test("price alert: la esec de send urmat de esec de rollback, esecul e RAPORTAT (reportRollbackFailure), nu inghitit (R[Medium] #1)", async () => {
  const reported: Array<{ guildId: string; kind: string; itemId: string }> = [];
  const service = createPriceAlertService({
    GuildModel: {
      updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 })
    },
    logger: () => undefined,
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "deals-channel",
        send: async () => { throw new Error("discord 500 la send"); }
      }
    }),
    disableDiscountsForChannelError: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    rollbackTriggeredAlert: async () => { throw new Error("mongo indisponibil la rollback"); },
    formatPrice: (value, currency) => `${value} ${currency}`,
    sleepIfPositive: async () => undefined,
    DISCORD_SEND_DELAY_MS: 0,
    rearmAbsentCycles: 3,
    reportRollbackFailure: (context) => { reported.push(context); }
  });
  const deals = new Map([["EUR", [{
    id: "deal-1", title: "Elden Ring", appId: "1245620", salePrice: 25, store: "Steam", link: "https://example.com/elden-ring"
  }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(alert), deals);

  assert.equal(reported.length, 1, "rollback-ul esuat dupa un send esuat e raportat ca alerta de admin, nu inghitit prin .catch(()=>undefined)");
  assert.deepEqual(reported[0], { guildId: "guild-1", kind: "price-alert", itemId: "elden-ring:EUR" }, "contextul raportat identifica jocul si moneda alertei ramase marcate ca declansate");
});

test("price alert service nu trimite daca alta instanta a revendicat deja alerta", async () => {
  const { service, sent } = makeService(false);
  const deals = new Map([["EUR", [{ title: "Elden Ring", appId: "1245620", salePrice: 25 }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(alert), deals);

  assert.equal(sent.length, 0);
});

test("price alert service rearmeaza alerta dupa ce pretul urca peste prag", async () => {
  const { service, updates, sent } = makeService(true);
  const triggered = { ...alert, triggeredAt: new Date("2026-06-24T06:00:00Z") };
  const deals = new Map([["EUR", [{ title: "Elden Ring", appId: "1245620", salePrice: 40 }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(triggered), deals);

  assert.equal(sent.length, 0);
  assert.ok(updates.some(call => {
    const setDoc = call.update.$set as Record<string, unknown> | undefined;
    return setDoc?.["priceAlerts.$[alert].triggeredAt"] === null;
  }));
});

test("price alert service rearmeaza dupa N cicluri in care jocul lipseste din feed-ul de reduceri (oferta s-a terminat)", async () => {
  const { service, updates, sent } = makeService(true, 2);
  const triggered = { ...alert, triggeredAt: new Date("2026-06-24T06:00:00Z"), absentCycles: 1 };
  const deals = new Map([["EUR", [{ title: "Cu totul alt joc", salePrice: 5 }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(triggered), deals);

  assert.equal(sent.length, 0);
  const rearm = updates.find(call => {
    const setDoc = call.update.$set as Record<string, unknown> | undefined;
    return setDoc?.["priceAlerts.$[alert].triggeredAt"] === null;
  });
  assert.ok(rearm, "alerta s-a rearmat la al doilea ciclu de absenta (absentCycles 1 -> 2 >= prag)");
  assert.equal((rearm.update.$set as Record<string, unknown>)["priceAlerts.$[alert].absentCycles"], 0, "contorul de absenta se reseteaza la rearmare");
});

test("price alert service doar incrementeaza contorul de absenta sub pragul de rearmare (nu rearmeaza inca)", async () => {
  const { service, updates, sent } = makeService(true, 3);
  const triggered = { ...alert, triggeredAt: new Date("2026-06-24T06:00:00Z"), absentCycles: 0 };
  const deals = new Map([["EUR", [{ title: "Cu totul alt joc", salePrice: 5 }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(triggered), deals);

  assert.equal(sent.length, 0);
  assert.equal(updates.length, 1);
  const setDoc = updates[0].update.$set as Record<string, unknown>;
  assert.equal(setDoc["priceAlerts.$[alert].absentCycles"], 1, "contorul creste la 1");
  assert.ok(!("priceAlerts.$[alert].triggeredAt" in setDoc), "nu se rearmeaza inca (sub prag)");
});

test("price alert service NU rearmeaza pe esec global de sursa (moneda lipseste din feed) - nicio scriere", async () => {
  const { service, updates, sent } = makeService(true, 1);
  const triggered = { ...alert, triggeredAt: new Date("2026-06-24T06:00:00Z"), absentCycles: 5 };
  const dealsWithoutCurrency = new Map<string, Array<Record<string, unknown>>>();

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(triggered), dealsWithoutCurrency);

  assert.equal(sent.length, 0);
  assert.equal(updates.length, 0, "fara feed pentru moneda (esec de sursa) nu se observa nimic, deci nu se rearmeaza");
});

test("price alert service reseteaza contorul de absenta cand jocul reapare in feed", async () => {
  const { service, updates } = makeService(true);
  const observed = { ...alert, triggeredAt: new Date("2026-06-24T06:00:00Z"), absentCycles: 2 };
  const deals = new Map([["EUR", [{ title: "Elden Ring", appId: "1245620", salePrice: 25 }]]]);

  await service.processGuildPriceAlerts(makeNotificationDiscordClient(), guild(observed), deals);

  assert.ok(updates.some(call => {
    const setDoc = call.update.$set as Record<string, unknown> | undefined;
    return setDoc?.["priceAlerts.$[alert].absentCycles"] === 0;
  }), "observarea jocului reseteaza absentCycles la 0");
});
