import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

const attachUpdates = require("../sources/updates") as (ctx: Record<string, any>) => void;
const attachDeals = require("../sources/deals") as (ctx: Record<string, any>) => void;
const attachSteam = require("../sources/steam") as (ctx: Record<string, any>) => void;

class TestSchemaDriftError extends Error {
  source?: string;

  constructor(message: string, source?: string) {
    super(message);
    this.source = source;
  }
}

function normalizeUpdate(data: Record<string, any>) {
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
  const ctx: Record<string, any> = {
    httpReq: async () => ({
      data: {
        appnews: {
          newsitems: [{
            feed_type: 1,
            url: "https://steamcommunity.com/games/730/announcements/detail/1",
            title: "Patch notes",
            contents: "bugfix update",
            date: 1_700_000_000
          }]
        }
      }
    }),
    normalizeUpdate,
    cleanText: (value: unknown) => String(value || "").trim()
  };
  attachUpdates(ctx);

  await assert.rejects(
    () => ctx.fetchSteamUpdate({ key: "cs2", name: "Counter-Strike 2", appId: "730" }),
    /gid/
  );
});

test("updates source reports schema drift when listing HTML has no valid anchors", async () => {
  const logs: Array<{ level: string; context: string; message: string }> = [];
  const ctx: Record<string, any> = {
    httpReq: async () => ({ data: "<html><body><main>No articles here</main></body></html>" }),
    safeCheerioLoad: (html: unknown) => cheerio.load(String(html || "")),
    cleanText: (value: unknown) => String(value || "").trim(),
    normalizeUpdate,
    logger: (level: string, context: string, message: string) => logs.push({ level, context, message }),
    SchemaDriftError: TestSchemaDriftError
  };
  attachUpdates(ctx);

  await assert.rejects(
    () => ctx.fetchListingBasedUpdate({
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
  const ctx: Record<string, any> = {
    logger() {},
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" }),
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
  attachDeals(ctx);
  return ctx;
}

test("deals source rejects empty or malformed upstream deal shapes", async () => {
  const ctx = makeDealsContext(async (_method, url) => {
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

  await assert.rejects(() => ctx.fetchDeals({ currency: "USD" }), /oferte valide/);
});

test("deals source keeps fallback end date when Epic sends malformed promo date", async () => {
  const ctx = makeDealsContext(async (_method, url) => {
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

  const deals = await ctx.fetchDeals({ currency: "USD" });
  assert.equal(deals.length, 1);
  assert.equal(deals[0].endDateStr, "Nespecificat");
});

test("steam source tolerates storesearch JSON without items array", async () => {
  const ctx: Record<string, any> = {
    logger() {},
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" }),
    safeCheerioLoad: (html: unknown) => cheerio.load(String(html || "")),
    httpReq: async () => ({ data: { unexpected: true } })
  };
  attachSteam(ctx);

  const items = await ctx.searchSteamGameByName("Counter-Strike 2", "USD");
  assert.deepEqual(items, []);
});
