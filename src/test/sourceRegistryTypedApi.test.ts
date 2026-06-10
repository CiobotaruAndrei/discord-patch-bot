import test from "node:test";
import assert from "node:assert/strict";
import type { CheerioAPI } from "cheerio";
import type { DealInfo, FetchDealsOptions } from "../types";
import type { SteamAppDetailsSummary } from "../sources/sourceApis";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-source-api";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";

type Mod = typeof import("../sources/sourceRegistry");
type Expect<T extends true> = T;

type _MaxHtmlBytesIsNumber = Expect<
  Mod["MAX_HTML_BYTES"] extends number ? (number extends Mod["MAX_HTML_BYTES"] ? true : false) : false
>;
type _DealHashIsTyped = Expect<
  Mod["dealHash"] extends (deal: DealInfo) => string ? true : false
>;
type _FetchDealsReturnsDeals = Expect<
  ReturnType<typeof import("../sources/sourceRegistry").createSourceRegistry>["fetchDeals"] extends (opts?: FetchDealsOptions) => Promise<DealInfo[]> ? true : false
>;
type _ExtractOfferEndIsTyped = Expect<
  Mod["extractOfferEndFromHtml"] extends (html: unknown) => string | null ? true : false
>;
type _SafeCheerioLoadIsTyped = Expect<
  Mod["safeCheerioLoad"] extends (html: unknown) => CheerioAPI ? true : false
>;

type _SteamPriceDetailsTyped = Expect<
  ReturnType<typeof import("../sources/sourceRegistry").createSourceRegistry>["fetchSteamPriceDetails"] extends (appId: string | number, currencyCode?: unknown) => Promise<SteamAppDetailsSummary | null> ? true : false
>;

const registry = require("../sources/sourceRegistry") as Record<string, unknown>;

test("sourceRegistry expune constantele tipate (numere + lista de user-agents)", () => {
  assert.equal(typeof registry.MAX_HTML_BYTES, "number", "MAX_HTML_BYTES e numar");
  assert.equal(typeof registry.MAX_JSON_BYTES, "number", "MAX_JSON_BYTES e numar");
  assert.equal(typeof registry.MAX_DEALS, "number", "MAX_DEALS e numar");
  assert.equal(typeof registry.FETCH_CONCURRENCY, "number", "FETCH_CONCURRENCY e numar");
  assert.ok(Array.isArray(registry.USER_AGENTS), "USER_AGENTS e tablou");
  assert.ok((registry.USER_AGENTS as unknown[]).length > 0, "USER_AGENTS nu e gol");
});

test("sourceRegistry expune cele 4 exporturi named ca valori de tipul declarat", () => {
  assert.equal(typeof registry.dealHash, "function", "dealHash e functie -> string");
  assert.equal(typeof registry.safeCheerioLoad, "function", "safeCheerioLoad e functie -> CheerioAPI");
  assert.equal(typeof registry.extractOfferEndFromHtml, "function", "extractOfferEndFromHtml e functie -> string|null");
  assert.equal(typeof registry.MAX_HTML_BYTES, "number", "MAX_HTML_BYTES e numar");
});

test("sourceRegistry expune utilele cross-cutting si functiile de sursa ca functii", () => {
  for (const key of [
    "cleanText", "truncate", "normalizeTitleForDedupe", "stableUpdateId", "normalizeUpdate",
    "levenshtein", "httpReq", "fetchWithProxy", "attachMetrics", "formatPrice",
    "fetchGameUpdate", "executeFetchWithCircuitBreaker", "getLatestForAllGames",
    "fetchSteamReviewData", "enrichDealData", "fetchDeals", "searchSteamGameByName",
    "chooseBestSteamMatch", "fetchSteamPriceDetails", "extractSteamOfferEndDate",
    "cleanEnrichedCache", "getEnrichedCacheSize"
  ]) {
    assert.equal(typeof registry[key], "function", `sourceRegistry.${key} e functie`);
  }
});
