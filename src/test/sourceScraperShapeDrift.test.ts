import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import attachUpdates from "../sources/updates";
import attachDeals from "../sources/deals";
import attachSteam from "../sources/steam";

type UpdatesBuildContext = Parameters<typeof attachUpdates.buildFrom>[0];
type DealsBuildContext = Parameters<typeof attachDeals.buildFrom>[0];
type SteamBuildContext = Parameters<typeof attachSteam.buildFrom>[0];
function asUpdatesContext(context: Record<string, unknown>): UpdatesBuildContext {
  return context as Record<string, unknown> & UpdatesBuildContext;
}
function asDealsContext(context: Record<string, unknown>): DealsBuildContext {
  return context as Record<string, unknown> & DealsBuildContext;
}
function asSteamContext(context: Record<string, unknown>): SteamBuildContext {
  return context as Record<string, unknown> & SteamBuildContext;
}

type UpdatesRuntime = {
  fetchSteamUpdate: (game: Record<string, unknown>) => Promise<unknown>;
  fetchListingBasedUpdate: (game: Record<string, unknown>) => Promise<unknown>;
};
type DealsRuntime = {
  fetchDeals: (options: { currency: string }) => Promise<Array<{ endDateStr?: string }>>;
};
type SteamRuntime = {
  searchSteamGameByName: (query: string, currency: string) => Promise<unknown[]>;
};

class TestSchemaDriftError extends Error {
  source?: string;

  constructor(message: string, source?: string) {
    super(message);
    this.source = source;
  }
}

function normalizeUpdate(data: Record<string, unknown>) {
  return {
    id: String(data.id || "id"),
    title: String(data.title || "title"),
    link: String(data.link || ""),
    excerpt: String(data.excerpt || ""),
    fullText: String(data.fullText || ""),
    image: data.image || null,
    thumbnail: data.thumbnail || null,
    timestamp: String(data.timestamp || "")
  };
}

test("updates source rejects Steam newsitems without gid", async () => {
  const context = {
    conditionalGet: async (_url: string, parse: (data: unknown) => unknown) => parse({
      appnews: {
        newsitems: [{
          feed_type: 1,
          url: "https://steamcommunity.com/games/730/announcements/detail/1",
          title: "Patch notes",
          contents: "bugfix update",
          date: 1_700_000_000
        }]
      }
    }),
    normalizeUpdate,
    cleanText: (value: unknown) => String(value || "").trim()
  };
  Object.assign(context, {
    runConcurrent: async (items: unknown[], _concurrency: number, fn: (item: unknown, index: number) => Promise<void>, opts?: { errorLogger?: (item: unknown, err: unknown) => void }) => {
      for (let i = 0; i < items.length; i++) {
        try { await fn(items[i], i); } catch (err) { opts?.errorLogger?.(items[i], err); }
      }
      return { processed: items.length, errors: [] };
    },
  });
  Object.assign(context, attachUpdates.buildFrom(asUpdatesContext(context)));
  const runtime = context as typeof context & UpdatesRuntime;

  await assert.rejects(
    () => runtime.fetchSteamUpdate({ key: "cs2", name: "Counter-Strike 2", appId: "730" }),
    /gid/
  );
});

test("updates source reports schema drift when listing HTML has no valid anchors", async () => {
  const logs: Array<{ level: string; context: string; message: string }> = [];
  const context = {
    httpReq: async () => ({ data: "<html><body><main>No articles here</main></body></html>" }),
    safeCheerioLoad: (html: unknown) => cheerio.load(String(html || "")),
    cleanText: (value: unknown) => String(value || "").trim(),
    normalizeUpdate,
    logger: (level: string, context: string, message: string) => logs.push({ level, context, message }),
    SchemaDriftError: TestSchemaDriftError
  };
  Object.assign(context, {
    runConcurrent: async (items: unknown[], _concurrency: number, fn: (item: unknown, index: number) => Promise<void>, opts?: { errorLogger?: (item: unknown, err: unknown) => void }) => {
      for (let i = 0; i < items.length; i++) {
        try { await fn(items[i], i); } catch (err) { opts?.errorLogger?.(items[i], err); }
      }
      return { processed: items.length, errors: [] };
    },
  });
  Object.assign(context, attachUpdates.buildFrom(asUpdatesContext(context)));
  const runtime = context as typeof context & UpdatesRuntime;

  await assert.rejects(
    () => runtime.fetchListingBasedUpdate({
      key: "vendor",
      name: "Vendor",
      listingUrl: "https://example.com/news",
      baseUrl: "https://example.com",
      articleHrefRegex: "/news/"
    }),
    (err: unknown) => err instanceof TestSchemaDriftError
      && (err as TestSchemaDriftError).source === "listing:vendor"
  );
  assert.equal(logs.length, 0);
});

function makeDealsContext(httpReq: (method: string, url: string, options?: unknown) => Promise<unknown>) {
  const context = {
    logger() {},
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" as const }),
    httpReq,
    normalizeTitleForDedupe: (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    trackInflight: <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => {
      map.set(key, promise);
      promise.finally(() => {
        if (map.get(key) === promise) map.delete(key);
      }).catch(() => undefined);
    },
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    extractOfferEndFromHtml: () => null,
    STEAM_REVIEW_BATCH_SIZE: 5,
    STEAM_REVIEW_BATCH_DELAY_MS: 0,
    ENRICHED_DEAL_CACHE_TTL_MS: 60_000,
    ENRICHED_DEAL_CACHE_MAX_SIZE: 20,
    STEAM_SPECIALS_LIMIT: 10,
    EPIC_SPECIALS_LIMIT: 10,
    MAX_DEALS: 10
  };
  Object.assign(context, attachDeals.buildFrom(asDealsContext(context)));
  return context as typeof context & DealsRuntime;
}

test("deals source rejects empty or malformed upstream deal shapes", async () => {
  const context = makeDealsContext(async (_method, url) => {
    if (String(url).includes("featuredcategories")) return { data: { specials: { items: [] } } };
    return {
      data: {
        data: {
          Catalog: {
            searchStore: {
              elements: [{ id: "epic-broken", title: "Broken Epic Offer" }]
            }
          }
        }
      }
    };
  });

  await assert.rejects(() => context.fetchDeals({ currency: "USD" }), /oferte valide/);
});

test("deals source keeps fallback end date when Epic sends malformed promo date", async () => {
  const context = makeDealsContext(async (_method, url) => {
    if (String(url).includes("featuredcategories")) return { data: { specials: { items: [] } } };
    return {
      data: {
        data: {
          Catalog: {
            searchStore: {
              elements: [{
                id: "epic-good",
                title: "Epic Game",
                urlSlug: "epic-game",
                keyImages: [{ type: "OfferImageWide", url: "https://cdn.example/image.jpg" }],
                price: { totalPrice: { originalPrice: 1000, discountPrice: 500 } },
                promotions: {
                  promotionalOffers: [{
                    promotionalOffers: [{ endDate: "not-a-date" }]
                  }]
                }
              }]
            }
          }
        }
      }
    };
  });

  const deals = await context.fetchDeals({ currency: "USD" });
  assert.equal(deals.length, 1);
  assert.equal(deals[0].endDateStr, "Nespecificat");
});

test("steam source tolerates storesearch JSON without items array", async () => {
  const context = {
    logger() {},
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" as const }),
    safeCheerioLoad: (html: unknown) => cheerio.load(String(html || "")),
    httpReq: async () => ({ data: { unexpected: true } })
  };
  Object.assign(context, attachSteam.buildFrom(asSteamContext(context)));
  const runtime = context as typeof context & SteamRuntime;

  const items = await runtime.searchSteamGameByName("Counter-Strike 2", "USD");
  assert.deepEqual(items, []);
});
