import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const Parser = require("rss-parser");

const attachUpdates = require("../sources/updates") as {
  createUpdates: (deps: Record<string, unknown>) => Record<string, (...args: never[]) => unknown>;
};
const attachDeals = require("../sources/deals") as {
  createDeals: (deps: Record<string, unknown>) => { fetchDeals: (opts?: { currency?: string }) => Promise<Array<Record<string, unknown>>> };
};

const fixturesDir = path.join(process.cwd(), "test", "fixtures");

function fixtureText(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

function fixtureJson<T>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

function normalizeUpdate(data: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(data.id || ""),
    title: String(data.title || ""),
    link: String(data.link || ""),
    excerpt: String(data.excerpt || ""),
    fullText: String(data.fullText || ""),
    image: data.image || null,
    thumbnail: data.thumbnail || null,
    timestamp: String(data.timestamp || "")
  };
}

function makeUpdatesDeps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    logger: () => undefined,
    crypto: { createHash: () => ({ update: () => ({ digest: () => "deadbeefcafe" }) }) },
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    trackInflight: () => undefined,
    runConcurrent: async (items: unknown[], _c: number, fn: (item: unknown, index: number) => Promise<void>) => {
      for (let i = 0; i < items.length; i++) await fn(items[i], i);
      return { errors: [] };
    },
    FETCH_CONCURRENCY: 10,
    FETCH_CONCURRENCY_STEAM: 4,
    FETCH_CONCURRENCY_EPIC: 2,
    FETCH_CONCURRENCY_LISTING: 8,
    FETCH_CONCURRENCY_DRIVER: 2,
    conditionalGet: async <T>(_url: string, parse: (raw: unknown) => T | Promise<T>) => parse({}),
    normalizeUpdate,
    cleanText: (text: unknown) => String(text == null ? "" : text).replace(/\s+/g, " ").trim(),
    rssParser: new Parser(),
    stableUpdateId: (title: unknown, link: unknown) => `stable:${String(title)}:${String(link)}`,
    ...overrides
  };
}

test("fixture Steam ISteamNews real: fetchSteamUpdate extrage gid-ul si titlul primului patch note", async () => {
  const fixture = fixtureJson<{ appnews: { newsitems: Array<{ gid: string; title: string; url: string }> } }>("steamNews.cs2.json");
  const deps = makeUpdatesDeps({
    conditionalGet: async <T>(_url: string, parse: (raw: unknown) => T | Promise<T>) => parse(fixture)
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchSteamUpdate = api.fetchSteamUpdate as unknown as (game: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const update = await fetchSteamUpdate({ key: "cs2", name: "CS2", appId: "730" });
  const fixtureGids = fixture.appnews.newsitems.map(item => item.gid);
  assert.ok(fixtureGids.includes(String(update.id)), `id-ul (${update.id}) provine dintr-un newsitem real din fixture`);
  assert.ok(String(update.title).length > 0, "titlul nu e gol");
  assert.match(String(update.link), /^https?:\/\//, "link-ul e URL absolut din raspunsul real");
});

test("fixture Minecraft piston-meta real: fetchMinecraftUpdate citeste latest.release", async () => {
  const fixture = fixtureJson<{ latest: { release: string } }>("minecraftManifest.json");
  const deps = makeUpdatesDeps({
    conditionalGet: async <T>(_url: string, parse: (raw: unknown) => T | Promise<T>) => parse(fixture)
  });
  const api = attachUpdates.createUpdates(deps);
  const update = await (api.fetchMinecraftUpdate as unknown as () => Promise<Record<string, unknown>>)();
  assert.equal(update.id, fixture.latest.release);
  assert.equal(update.title, `Minecraft ${fixture.latest.release}`);
});

test("fixture Roblox client-version real: fetchRobloxUpdate citeste clientVersionUpload", async () => {
  const fixture = fixtureJson<{ clientVersionUpload: string }>("robloxClientVersion.json");
  const deps = makeUpdatesDeps({
    conditionalGet: async <T>(_url: string, parse: (raw: unknown) => T | Promise<T>) => parse(fixture)
  });
  const api = attachUpdates.createUpdates(deps);
  const update = await (api.fetchRobloxUpdate as unknown as () => Promise<Record<string, unknown>>)();
  assert.equal(update.id, fixture.clientVersionUpload);
});

test("fixture Google News RSS real (NVIDIA): fetchNvidiaUpdate parseaza feed-ul cu rss-parser real", async () => {
  const xml = fixtureText("googleNewsNvidia.rss.xml");
  const parser = new Parser();
  const parsed = await parser.parseString(xml);
  const expectedTitle = String(parsed.items?.[0]?.title || "").split(" - ")[0].replace(/\s+/g, " ").trim();
  assert.ok(expectedTitle.length > 0, "fixture-ul are macar un item cu titlu");
  const deps = makeUpdatesDeps({
    conditionalGet: async <T>(_url: string, parse: (raw: unknown) => T | Promise<T>) => parse(xml)
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchNvidiaUpdate = api.fetchNvidiaUpdate as unknown as (game: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const update = await fetchNvidiaUpdate({ key: "nvidia", name: "NVIDIA" });
  assert.equal(update.title, expectedTitle);
});

test("fixture AMD: pagina reala nu mai expune 'Adrenalin Edition X.Y.Z' in HTML static -> cade pe RSS-ul real", async () => {
  const xml = fixtureText("googleNewsAmd.rss.xml");
  const parser = new Parser();
  const parsed = await parser.parseString(xml);
  const expectedTitle = String(parsed.items?.[0]?.title || "").split(" - ")[0].replace(/\s+/g, " ").trim();
  const deps = makeUpdatesDeps({
    fetchWithProxy: async () => "<html><body>pagina amd fara versiune in html static</body></html>",
    httpReq: async () => ({ data: xml })
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchAmdUpdate = api.fetchAmdUpdate as unknown as (game: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const update = await fetchAmdUpdate({ key: "amd", name: "AMD" });
  assert.equal(update.title, expectedTitle);
  assert.match(String(update.title), /Adrenalin/i, "titlul din feed-ul real contine Adrenalin");
});

test("fixture Intel: pagina reala nu mai expune versiunea in HTML static -> cade pe RSS-ul real", async () => {
  const xml = fixtureText("googleNewsIntel.rss.xml");
  const parser = new Parser();
  const parsed = await parser.parseString(xml);
  const expectedTitle = String(parsed.items?.[0]?.title || "").split(" - ")[0].replace(/\s+/g, " ").trim();
  const deps = makeUpdatesDeps({
    fetchWithProxy: async () => "<html><body>pagina intel fara versiune in html static</body></html>",
    httpReq: async () => ({ data: xml })
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchIntelUpdate = api.fetchIntelUpdate as unknown as (game: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const update = await fetchIntelUpdate({ key: "intelgameon", name: "Intel", url: "https://www.intel.com/x" });
  assert.equal(update.title, expectedTitle);
});

test("fixture deals reale: fetchDeals combina Steam specials + Epic GraphQL si calculeaza corect preturile", async () => {
  const featured = fixtureJson<{ specials: { items: Array<{ id: number; name: string; original_price: number; final_price: number; discount_percent: number }> } }>("steamFeaturedCategories.json");
  const reviews = fixtureJson<Record<string, unknown>>("steamAppReviews.json");
  const epic = fixtureJson<{ data: { Catalog: { searchStore: { elements: Array<{ id: string; title: string; price: { totalPrice: { discountPrice: number; originalPrice: number } } }> } } } }>("epicGraphqlSearchStore.json");

  const deps = {
    logger: () => undefined,
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" }),
    httpReq: async (_method: string, url: string) => {
      if (url.includes("featuredcategories")) return { data: featured };
      if (url.includes("appreviews")) return { data: reviews };
      if (url.includes("store.epicgames.com/graphql")) return { data: epic };
      throw new Error(`URL neasteptat in test: ${url}`);
    },
    normalizeTitleForDedupe: (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    trackInflight: () => undefined,
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    extractOfferEndFromHtml: () => null,
    STEAM_REVIEW_BATCH_SIZE: 5,
    STEAM_REVIEW_BATCH_DELAY_MS: 0,
    ENRICHED_DEAL_CACHE_TTL_MS: 0,
    ENRICHED_DEAL_CACHE_MAX_SIZE: 0,
    STEAM_SPECIALS_LIMIT: 10,
    EPIC_SPECIALS_LIMIT: 10,
    MAX_DEALS: 50
  };
  const api = attachDeals.createDeals(deps);
  const deals = await api.fetchDeals({ currency: "USD" });

  const firstSpecial = featured.specials.items[0];
  const steamDeal = deals.find(deal => deal.id === `steam_${firstSpecial.id}`);
  assert.ok(steamDeal, "oferta Steam din fixture-ul real e prezenta");
  assert.equal(steamDeal!.savings, firstSpecial.discount_percent);
  assert.equal(steamDeal!.salePrice, (firstSpecial.final_price / 100).toFixed(2));

  const firstEpic = epic.data.Catalog.searchStore.elements[0];
  const epicDeal = deals.find(deal => deal.id === `epic_${firstEpic.id}`);
  assert.ok(epicDeal, "oferta Epic din fixture-ul real e prezenta");
  const { originalPrice, discountPrice } = firstEpic.price.totalPrice;
  assert.equal(epicDeal!.savings, Math.max(0, Math.round(((originalPrice - discountPrice) / originalPrice) * 100)));
  assert.equal(epicDeal!.salePrice, (discountPrice / 100).toFixed(2));
});
