import test from "node:test";
import assert from "node:assert/strict";
import { connectMongoWithRetry, hydrateStartupCaches } from "../../app/appRuntime.js";
import type { DealInfo, FetchResult } from "../../types.js";

test("composition root transmite configuratia Mongo catre faza de conectare", async () => {
  const calls: Array<{ uri: string; maxPoolSize?: number }> = [];
  await connectMongoWithRetry({
    mongoose: { connect: async (uri, options) => { calls.push({ uri, maxPoolSize: options?.maxPoolSize }); return undefined; } },
    errorMessage: error => String(error),
    mongo: { logger: () => undefined, env: { MONGO_URI: "mongodb://runtime", MONGO_MAX_POOL_SIZE: 17 } }
  });
  assert.deepEqual(calls, [{ uri: "mongodb://runtime", maxPoolSize: 17 }]);
});

test("composition root hidrateaza numai snapshot-urile proaspete prin contractele injectate", async () => {
  const now = Date.now();
  const updates: FetchResult[] = [];
  const deals: DealInfo[] = [];
  const hydratedUpdates: Array<FetchResult[] | null> = [];
  const hydratedDeals: Array<{ currency: string; payload: DealInfo[] }> = [];
  await hydrateStartupCaches({
    commands: {
      setUpdatesCache: payload => { hydratedUpdates.push(payload); },
      setDealsCache: (currency, payload) => { hydratedDeals.push({ currency, payload }); }
    },
    mongo: {
      logger: () => undefined,
      loadFetchSnapshot: async () => ({ payload: updates, fetchedAt: new Date(now - 1000) }),
      loadDealsFetchSnapshots: async () => [
        { currency: "EUR", payload: deals, fetchedAt: new Date(now - 1000) },
        { currency: "USD", payload: deals, fetchedAt: new Date(now - 60 * 60 * 1000) }
      ]
    }
  });
  assert.deepEqual(hydratedUpdates, [updates]);
  assert.deepEqual(hydratedDeals, [{ currency: "EUR", payload: deals }]);
});
