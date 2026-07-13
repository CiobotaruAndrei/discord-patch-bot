import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import type { ValidatedDealInfo } from "../types.js";

type UtilitiesModule = typeof import("../shared/utilities.js")["default"] & {
  validatePendingDiscountSnapshot: (snapshot: unknown) => snapshot is ValidatedDealInfo;
};
type UpdatesRuntime = {
  fetchListingBasedUpdate: (game: Record<string, unknown>) => Promise<unknown>;
};

import attachUpdates from "../sources/updates/index.js";
type UpdatesBuildContext = Parameters<typeof attachUpdates.buildFrom>[0];
function asUpdatesContext(context: Record<string, unknown>): UpdatesBuildContext {
  return context as Record<string, unknown> & UpdatesBuildContext;
}

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

test("sources/updates: fetchListingBasedUpdate arunca plain Error (nu SchemaDriftError) cand articolele esueaza transient", async () => {
  const listingUrl = "https://example.com/news";
  const context = {
    httpReq: async (_method: string, url: string) => {
      if (url === listingUrl) {
        return { data: '<html><body><a href="/news/patch-1">Patch Notes Update</a></body></html>' };
      }
      throw new Error("transient network blip");
    },
    safeCheerioLoad: (html: unknown) => cheerio.load(String(html || "")),
    cleanText: (value: unknown) => String(value || "").trim(),
    normalizeUpdate,
    logger: () => undefined,
    SchemaDriftError: TestSchemaDriftError,
    runConcurrent: async (items: unknown[], _concurrency: number, fn: (item: unknown, index: number) => Promise<void>, opts?: { errorLogger?: (item: unknown, err: unknown) => void }) => {
      for (let i = 0; i < items.length; i++) {
        try { await fn(items[i], i); } catch (err) { opts?.errorLogger?.(items[i], err); }
      }
      return { processed: items.length, errors: [] };
    },
  };
  Object.assign(context, attachUpdates.buildFrom(asUpdatesContext(context)));
  const runtime = context as typeof context & UpdatesRuntime;

  await assert.rejects(
    () => runtime.fetchListingBasedUpdate({
      key: "vendor",
      name: "Vendor",
      listingUrl,
      baseUrl: "https://example.com",
      articleHrefRegex: "/news/"
    }),
    (err: unknown) => err instanceof Error
      && !(err instanceof TestSchemaDriftError)
      && /Niciun articol/.test(err.message)
  );
});

test("native/fuzzy: findGameKeys cu input mixed-emoji nu crash", () => {
  const { findGameKeys } = require("../native/fuzzy") as typeof import("../native/fuzzy.js");
  const games = [
    { key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] },
    { key: "fortnite", name: "Fortnite", aliases: [] }
  ];
  const result = findGameKeys("\u{1F600}cs2", games, 50);
  assert.ok(result, "trebuie sa returneze un obiect (gameKey/suggestionKey)");
});

test("native/fuzzy: findGameKeys trunchiaza input multi-codepoint (emoji) determinist", () => {
  const { findGameKeys } = require("../native/fuzzy") as typeof import("../native/fuzzy.js");
  const games = [{ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }];
  const longEmoji = "\u{1F600}".repeat(40) + "cs2";
  const first = findGameKeys(longEmoji, games, 10);
  const second = findGameKeys(longEmoji, games, 10);
  assert.deepEqual(first, second, "acelasi input → acelasi rezultat (codepoint-safe, fara crash)");
});

test("validatePendingDiscountSnapshot: accepta savings ca numar finit", () => {
  const { validatePendingDiscountSnapshot } = require("../shared/utilities").default as UtilitiesModule;
  const base = { title: "Game", store: "Steam", link: "https://x", salePrice: "10", normalPrice: "20" };

  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: 50 }), true);

  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: "33" }), true,
    "string numeric-coercible nu mai trebuie respins");
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: "0" }), true);

  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: NaN }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: "abc" }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: undefined }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: null }), false);
});

test("validatePendingDiscountSnapshot: narrow-uie la deal validat cu savings numeric sau string", () => {
  const { validatePendingDiscountSnapshot } = require("../shared/utilities").default as UtilitiesModule;
  const candidate: unknown = { title: "Game", store: "Steam", link: "https://x", salePrice: "10", normalPrice: "20", savings: "33" };
  if (!validatePendingDiscountSnapshot(candidate)) throw new Error("snapshot invalid in fixture");
  const validated: ValidatedDealInfo = candidate;
  assert.equal(validated.savings, "33");
  assert.equal(Number(validated.savings), 33);
});

test("validatePendingDiscountSnapshot: pastreaza restul validarilor stricte", () => {
  const { validatePendingDiscountSnapshot } = require("../shared/utilities").default as UtilitiesModule;
  const base = { title: "Game", store: "Steam", link: "https://x", salePrice: "10", normalPrice: "20", savings: 50 };

  assert.equal(validatePendingDiscountSnapshot({ ...base, title: undefined }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, title: "" }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, store: undefined }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, link: undefined }), false);

  assert.equal(validatePendingDiscountSnapshot({ ...base, salePrice: {} }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, normalPrice: [] }), false);

  assert.equal(validatePendingDiscountSnapshot(null), false);
  assert.equal(validatePendingDiscountSnapshot(undefined), false);
  assert.equal(validatePendingDiscountSnapshot("not an object"), false);
});
