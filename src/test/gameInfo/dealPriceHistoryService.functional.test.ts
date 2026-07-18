import test from "node:test";
import assert from "node:assert/strict";

import {
  createDealPriceHistoryService,
  dealPriceSeriesIdentity,
  summarizeDealPriceHistory
} from "../../features/game-info/dealPriceHistoryService.js";

interface StoredPrice {
  _id: string;
  gameKey: string;
  title: string;
  store: string;
  currency: string;
  price: number;
  fetchedAt: Date;
}

function harness() {
  const docs: StoredPrice[] = [];
  const service = createDealPriceHistoryService({
    DealPriceSnapshotModel: {
      bulkWrite: async operations => {
        for (const operation of operations) {
          const document = operation.updateOne.update.$set;
          const index = docs.findIndex(item => item._id === document._id);
          if (index >= 0) docs[index] = document;
          else docs.push(document);
        }
        return {};
      },
      find: filter => ({
        sort: () => ({
          lean: async () => docs.filter(doc =>
            doc.gameKey === filter.gameKey
            && doc.store === filter.store
            && doc.currency === filter.currency
          )
        })
      })
    }
  });
  return { service, docs };
}

test("snapshot-urile sunt idempotente pe ora si separate pe magazin si valuta", async () => {
  const suite = harness();
  const at = new Date("2026-07-18T10:10:00.000Z");
  await suite.service.recordDealPriceSnapshots([
    { title: "Game", appId: "10", store: "Steam", currency: "EUR", salePrice: 20 },
    { title: "Game", appId: "10", store: "Epic", currency: "EUR", salePrice: 18 },
    { title: "Game", appId: "10", store: "Steam", currency: "USD", salePrice: 22 }
  ], "EUR", at);
  await suite.service.recordDealPriceSnapshots([
    { title: "Game", appId: "10", store: "Steam", currency: "EUR", salePrice: 19 }
  ], "EUR", new Date("2026-07-18T10:50:00.000Z"));

  assert.equal(suite.docs.length, 3);
  assert.equal(suite.docs.find(doc => doc.store === "steam" && doc.currency === "EUR")?.price, 19);
  const eurSteam = await suite.service.readDealPriceHistory({ title: "Game", appId: "10", store: "Steam", currency: "EUR" }, "EUR", new Date(0));
  assert.deepEqual(eurSteam.map(point => point.price), [19]);
});

test("sumarul calculeaza minim, mediana si increderea din snapshot-uri valide", () => {
  const summary = summarizeDealPriceHistory([10, 20, 30, 40].map((price, index) => ({ price, at: new Date(2026, 0, index + 1) })));
  assert.deepEqual(summary, { sampleCount: 4, historicalMin: 10, recentMedian: 25, confidence: "medium" });
});

test("identitatea seriei nu amesteca magazinul sau valuta", () => {
  const steamEur = dealPriceSeriesIdentity({ appId: "10", store: "Steam", currency: "EUR" }, "USD");
  const epicEur = dealPriceSeriesIdentity({ appId: "10", store: "Epic", currency: "EUR" }, "USD");
  const steamUsd = dealPriceSeriesIdentity({ appId: "10", store: "Steam", currency: "USD" }, "EUR");
  assert.notDeepEqual(steamEur, epicEur);
  assert.notDeepEqual(steamEur, steamUsd);
});
