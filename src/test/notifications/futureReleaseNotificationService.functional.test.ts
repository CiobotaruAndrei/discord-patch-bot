import test from "node:test";
import assert from "node:assert/strict";

import { createFutureReleaseNotificationService } from "../../features/notifications/futureReleaseNotificationService.js";
import type { FutureReleaseGameEntry } from "../../types.js";

const NOW = new Date("2026-07-18T00:00:00.000Z");

function harness(entry: FutureReleaseGameEntry, initializing = false) {
  const sends: Array<{ payload: Record<string, unknown>; meta?: Record<string, unknown> }> = [];
  const writes: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> | Array<Record<string, unknown>> }> = [];
  const guild = {
    _id: "guild-1",
    futureReleaseChannelId: "channel-1",
    futureReleaseActivationId: "activation-1",
    futureReleaseInitializing: initializing,
    futureReleaseGames: [entry],
    currency: "EUR"
  };
  const GuildModel = {
    find: () => ({ lean: async () => [guild] }),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown> | Array<Record<string, unknown>>) => {
      writes.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
  const service = createFutureReleaseNotificationService({
    GuildModel,
    logger: () => undefined,
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "channel-1",
        send: async (payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
          sends.push({ payload, meta });
        }
      }
    }),
    searchSteamGameByName: async () => [{ id: "10", name: "Silksong", type: "game" }],
    chooseBestSteamMatch: items => items[0] ?? null,
    fetchSteamPriceDetails: async () => ({
      name: "Silksong",
      release_date: { coming_soon: true, date: "August 7, 2026" },
      price_overview: { initial: 4000, final: 4000, discount_percent: 0, final_formatted: "39,99 EUR" }
    }),
    DEFAULT_CURRENCY: "EUR",
    now: () => NOW
  });
  return { service, sends, writes, guild };
}

test("future-release initializeaza baseline-ul fara notificari si inchide activarea curenta", async () => {
  const { service, sends, writes } = harness({
    gameName: "silksong",
    addedBy: "admin",
    addedAt: NOW,
    baselineDone: false
  }, true);
  await service.checkForFutureReleases({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(sends.length, 0);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].filter.futureReleaseActivationId, "activation-1");
  assert.equal(writes[1].filter.futureReleaseInitializing, true);
});

test("future-release publica pragul si preorder-ul prin canalul outbox si persista starea", async () => {
  const { service, sends, writes } = harness({
    gameName: "silksong",
    addedBy: "admin",
    addedAt: NOW,
    baselineDone: true,
    notifiedThresholdDays: [],
    preorderSeen: false,
    observedPreorderPrice: null
  });
  await service.checkForFutureReleases({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(sends.length, 2);
  assert.match(JSON.stringify(sends), /future-release/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter.futureReleaseActivationId, "activation-1");
});

test("future-release nu finalizeaza initializarea cand sursa live nu raspunde", async () => {
  const { writes } = harness({
    gameName: "silksong",
    addedBy: "admin",
    addedAt: NOW,
    sourceAppId: "10",
    baselineDone: false
  }, true);
  const failing = createFutureReleaseNotificationService({
    GuildModel: {
      find: () => ({ lean: async () => [{
        _id: "guild-1",
        futureReleaseChannelId: "channel-1",
        futureReleaseActivationId: "activation-1",
        futureReleaseInitializing: true,
        futureReleaseGames: [{ gameName: "silksong", addedBy: "admin", addedAt: NOW, sourceAppId: "10", baselineDone: false }]
      }] }),
      updateOne: async () => {
        writes.push({ filter: {}, update: {} });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "channel-1", send: async () => undefined } }),
    searchSteamGameByName: async () => [],
    chooseBestSteamMatch: () => null,
    fetchSteamPriceDetails: async () => null,
    DEFAULT_CURRENCY: "EUR",
    now: () => NOW
  });
  await failing.checkForFutureReleases({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(writes.length, 0);
});
