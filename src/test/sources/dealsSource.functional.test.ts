import test from "node:test";
import attachDeals from "../../sources/deals/index.js";
import assert from "node:assert/strict";

interface FakeCurrencyConfig { cc: string; symbol: string; placement: "prefix" | "suffix" }
interface FakeHttpResponse { data: unknown }
interface DealInfoShape {
  id?: string;
  title?: string;
  store?: string;
  steamAppID?: string | number | null;
  link?: string;
  endDateStr?: string | null;
  extraDetails?: string;
  enriched?: boolean;
  popularityScore?: number;
  [key: string]: unknown;
}
interface DealsDepsShape {
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  getCurrencyConfig: (code?: string | null) => FakeCurrencyConfig;
  httpReq: (method: string, url: string, options?: unknown, retries?: number, backoff?: number) => Promise<FakeHttpResponse>;
  normalizeTitleForDedupe: (value: unknown) => string;
  trackInflight: <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => void;
  withInflightTimeout: <T>(promise: Promise<T>, label: string) => Promise<T>;
  extractOfferEndFromHtml: (html: unknown) => string | null;
  STEAM_REVIEW_BATCH_SIZE: number;
  STEAM_REVIEW_BATCH_DELAY_MS: number;
  ENRICHED_DEAL_CACHE_TTL_MS: number;
  ENRICHED_DEAL_CACHE_MAX_SIZE: number;
  STEAM_SPECIALS_LIMIT: number;
  EPIC_SPECIALS_LIMIT: number;
  MAX_DEALS: number;
}
interface DealsApiShape {
  fetchSteamReviewData: (appId: string | number) => Promise<{ totalReviews: number; qualityPercent: number; success: boolean }>;
  enrichCacheGet: (dealId: unknown, currency: string) => DealInfoShape | null;
  enrichCacheSet: (dealId: unknown, enriched: DealInfoShape, currency: string) => void;
  cleanEnrichedCache: () => void;
  getEnrichedCacheSize: () => number;
  enrichDealData: (deal: DealInfoShape, currencyCode?: string) => Promise<DealInfoShape>;
  fetchDeals: (opts?: { currency?: string; fromCron?: boolean }) => Promise<DealInfoShape[]>;
}

function makeDeps(overrides: Partial<DealsDepsShape> = {}): { deps: DealsDepsShape; calls: string[] } {
  const calls: string[] = [];
  const deps: DealsDepsShape = {
    logger: () => undefined,
    getCurrencyConfig: () => ({ cc: "us", symbol: "$", placement: "prefix" }),
    httpReq: async (_method, url) => { calls.push(url); return { data: {} }; },
    normalizeTitleForDedupe: (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    trackInflight: <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => {
      map.set(key, promise);
      promise.finally(() => { if (map.get(key) === promise) map.delete(key); }).catch(() => undefined);
    },
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    extractOfferEndFromHtml: () => null,
    STEAM_REVIEW_BATCH_SIZE: 5,
    STEAM_REVIEW_BATCH_DELAY_MS: 0,
    ENRICHED_DEAL_CACHE_TTL_MS: 60_000,
    ENRICHED_DEAL_CACHE_MAX_SIZE: 50,
    STEAM_SPECIALS_LIMIT: 10,
    EPIC_SPECIALS_LIMIT: 10,
    MAX_DEALS: 10,
    ...overrides
  };
  return { deps, calls };
}

test("createDeals: factory decuplat cu deps explicit tipate (fara target/Object.assign)", () => {
  const { deps } = makeDeps();
  const api = attachDeals.createDeals(deps);
  for (const fn of ["fetchSteamReviewData", "enrichCacheGet", "enrichCacheSet", "cleanEnrichedCache", "getEnrichedCacheSize", "enrichDealData", "fetchDeals"] as const) {
    assert.equal(typeof api[fn], "function", `api expune ${fn}`);
  }
});

test("createDeals.fetchSteamReviewData foloseste deps.httpReq si calculeaza qualityPercent", async () => {
  const { deps, calls } = makeDeps({
    httpReq: async (_m, url) => { calls.push(url); return { data: { query_summary: { total_reviews: 200, total_positive: 150 } } }; }
  });
  const api = attachDeals.createDeals(deps);
  const review = await api.fetchSteamReviewData(730);
  assert.deepEqual(review, { totalReviews: 200, qualityPercent: 75, success: true });
  assert.ok(calls.some(u => u.includes("appreviews/730")), "a cerut endpoint-ul de review prin deps.httpReq");
});

test("createDeals enrich cache: set/get round-trip izolat pe moneda", () => {
  const { deps } = makeDeps();
  const api = attachDeals.createDeals(deps);
  const before = api.getEnrichedCacheSize();
  const enriched: DealInfoShape = { id: "func-test-deal-1", store: "Steam", enriched: true, title: "X" };
  api.enrichCacheSet("func-test-deal-1", enriched, "USD");
  const got = api.enrichCacheGet("func-test-deal-1", "USD");
  assert.equal(got?.id, "func-test-deal-1", "get returneaza dealul cache-uit");
  assert.ok(api.getEnrichedCacheSize() > before, "dimensiunea cache-ului a crescut");
  assert.equal(api.enrichCacheGet("func-test-deal-1", "EUR"), null, "moneda diferita -> cache miss");
});

test("createDeals enrich cache: dezactivat cand MAX_SIZE este 0", () => {
  const { deps } = makeDeps({ ENRICHED_DEAL_CACHE_MAX_SIZE: 0 });
  const api = attachDeals.createDeals(deps);
  api.enrichCacheSet("func-test-deal-zero", { id: "func-test-deal-zero", enriched: true }, "USD");
  assert.equal(api.enrichCacheGet("func-test-deal-zero", "USD"), null, "cache dezactivat -> niciun hit");
});

test("createDeals.fetchDeals construieste oferte din deps.httpReq (Steam + Epic)", async () => {
  const { deps, calls } = makeDeps({
    httpReq: async (_m, url) => {
      calls.push(url);
      if (String(url).includes("featuredcategories")) {
        return { data: { specials: { items: [{ id: 100, name: "Steam Deal", original_price: 2000, final_price: 1000, discount_percent: 50, header_image: null }] } } };
      }
      if (String(url).includes("appreviews")) {
        return { data: { query_summary: { total_reviews: 100, total_positive: 90 } } };
      }
      return { data: { data: { Catalog: { searchStore: { elements: [{ id: "epic-1", title: "Epic Deal", urlSlug: "epic-deal", price: { totalPrice: { originalPrice: 3000, discountPrice: 1500 } } }] } } } } };
    }
  });
  const api = attachDeals.createDeals(deps);
  const deals = await api.fetchDeals({ currency: "USD" });
  const titles = deals.map(d => d.title).sort();
  assert.deepEqual(titles, ["Epic Deal", "Steam Deal"]);
  assert.ok(calls.some(u => u.includes("featuredcategories")), "a cerut Steam featuredcategories prin deps.httpReq");
  assert.ok(calls.some(u => u === "https://store.epicgames.com/graphql"), "a cerut Epic GraphQL pe hostul store.epicgames.com (regresie: graphql.epicgames.com a fost retras de Epic si raspunde 404 Gone)");
});

test("createDeals.fetchDeals coaleseaza apelurile in curs pe acelasi context", async () => {
  let httpCalls = 0;
  const { deps } = makeDeps({
    httpReq: async (_m, url) => {
      httpCalls++;
      if (String(url).includes("featuredcategories")) return { data: { specials: { items: [] } } };
      return { data: { data: { Catalog: { searchStore: { elements: [{ id: "epic-coalesce", title: "Coalesce", urlSlug: "c", price: { totalPrice: { originalPrice: 1000, discountPrice: 500 } } }] } } } } };
    }
  });
  const api = attachDeals.createDeals(deps);
  const [r1, r2] = await Promise.all([
    api.fetchDeals({ currency: "RON", fromCron: true }),
    api.fetchDeals({ currency: "RON", fromCron: true })
  ]);
  assert.equal(r1, r2, "ambele apeluri rezolva la acelasi array (promisiune in curs refolosita)");
  assert.equal(httpCalls, 2, "o singura executie _fetchDealsImpl (Steam + Epic), nu duplicata");
});

test("createDeals.enrichDealData imbogateste oferta Steam folosind deps", async () => {
  const { deps, calls } = makeDeps({
    httpReq: async (_m, url) => {
      calls.push(url);
      if (String(url).includes("appdetails")) {
        return { data: { "999": { data: { platforms: { windows: true, mac: false, linux: true } } } } };
      }
      return { data: "<html>store page</html>" };
    },
    extractOfferEndFromHtml: (html: unknown) => String(html).includes("store page") ? "31 Dec" : null
  });
  const api = attachDeals.createDeals(deps);
  const enriched = await api.enrichDealData({
    id: "enrich-steam-1",
    store: "Steam",
    steamAppID: 999,
    link: "https://store.steampowered.com/app/999",
    enriched: false
  }, "USD");
  assert.equal(enriched.enriched, true, "marcheaza oferta ca imbogatita");
  assert.equal(enriched.endDateStr, "31 Dec", "preia data expirarii prin deps.extractOfferEndFromHtml");
  assert.match(String(enriched.extraDetails), /Win/, "adauga platformele din appdetails");
});

test("createDeals: doua instante cu deps diferite nu se suprascriu (regresie: deps era variabila globala de modul)", async () => {
  const { deps: depsA, calls: callsA } = makeDeps({
    httpReq: async (_m, url) => { callsA.push(url); return { data: { query_summary: { total_reviews: 10, total_positive: 9 } } }; }
  });
  const { deps: depsB, calls: callsB } = makeDeps({
    httpReq: async (_m, url) => { callsB.push(url); return { data: { query_summary: { total_reviews: 1, total_positive: 0 } } }; }
  });
  const apiA = attachDeals.createDeals(depsA);
  attachDeals.createDeals(depsB);
  const review = await apiA.fetchSteamReviewData("620");
  assert.equal(review.totalReviews, 10, "instanta A foloseste deps-ul ei, nu pe al instantei B create ulterior");
  assert.equal(callsA.length, 1);
  assert.equal(callsB.length, 0, "deps-ul instantei B nu e atins de apelul pe A");
});

test("createDeals: coalescing-ul inflight e per instanta, nu partajat intre instante (regresie: inflightDeals era global de modul)", async () => {
  const never = new Promise<FakeHttpResponse>(() => undefined);
  const { deps: depsA } = makeDeps({ httpReq: () => never });
  const { deps: depsB, calls: callsB } = makeDeps({
    httpReq: async (_m, url) => {
      callsB.push(url);
      if (url.includes("featuredcategories")) {
        return { data: { specials: { items: [{ id: 42, name: "Joc B", original_price: 1000, final_price: 500, discount_percent: 50 }] } } };
      }
      return { data: { query_summary: { total_reviews: 5, total_positive: 5 } } };
    }
  });
  const apiA = attachDeals.createDeals(depsA);
  const apiB = attachDeals.createDeals(depsB);
  void apiA.fetchDeals({ currency: "USD" });
  const timeout = new Promise<"timeout">(resolve => { setTimeout(() => resolve("timeout"), 500).unref(); });
  const raced = await Promise.race([apiB.fetchDeals({ currency: "USD" }), timeout]);
  assert.notEqual(raced, "timeout", "instanta B nu trebuie sa astepte promisiunea inflight (blocata) a instantei A");
  const deals = raced as Array<{ id: string }>;
  assert.equal(deals[0]?.id, "steam_42", "B isi produce propriile rezultate");
  assert.ok(callsB.length >= 1);
});

test("createDeals.fetchDeals: Steam si Epic se fetch-uiesc in PARALEL, nu secvential", async () => {
  let resolveEpicStarted!: () => void;
  const epicStarted = new Promise<void>(resolve => { resolveEpicStarted = resolve; });
  const { deps } = makeDeps({
    httpReq: async (_m, url) => {
      if (String(url).includes("featuredcategories")) {
        await Promise.race([
          epicStarted,
          new Promise((_resolve, reject) => { setTimeout(() => reject(new Error("Epic nu a pornit cat timp Steam era in zbor — fetch-ul a redevenit secvential")), 2000).unref(); })
        ]);
        return { data: { specials: { items: [{ id: 100, name: "Steam Deal", original_price: 2000, final_price: 1000, discount_percent: 50, header_image: null }] } } };
      }
      if (String(url).includes("appreviews")) {
        return { data: { query_summary: { total_reviews: 100, total_positive: 90 } } };
      }
      resolveEpicStarted();
      return { data: { data: { Catalog: { searchStore: { elements: [{ id: "epic-1", title: "Epic Deal", urlSlug: "epic-deal", price: { totalPrice: { originalPrice: 3000, discountPrice: 1500 } } }] } } } } };
    }
  });
  const api = attachDeals.createDeals(deps);
  const deals = await api.fetchDeals({ currency: "USD" });
  const titles = deals.map(d => d.title).sort();
  assert.deepEqual(titles, ["Epic Deal", "Steam Deal"],
    "Steam-ul (blocat pana porneste Epic) reuseste doar daca cele doua fetch-uri ruleaza concurent");
});
