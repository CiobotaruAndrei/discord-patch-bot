import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

type UpdatesRuntime = {
  fetchListingBasedUpdate: (game: Record<string, unknown>) => Promise<{ link: string; title: string }>;
};

const attachUpdates = require("../sources/updates") as (context: Record<string, unknown>) => void;

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

test("fetchListingBasedUpdate ranks keyword-tied candidates by newest in-URL date", async () => {
  const listingUrl = "https://example.com/news";
  const winner = "https://example.com/news/2024-08-20-patch-notes";
  const listingHtml = [
    '<html><body>',
    '<a href="/news/2024-01-10-patch-notes">Patch Notes Jan</a>',
    '<a href="/news/2024-08-20-patch-notes">Patch Notes Aug</a>',
    '<a href="/news/patch-notes-undated">Patch Notes Undated</a>',
    '<a href="/misc/ignored">Ignored Section</a>',
    '<a href="/news/2024-03-05-trailer">Trailer Reveal</a>',
    '</body></html>'
  ].join("");

  const context = {
    httpReq: async (_method: string, url: string) => {
      if (url === listingUrl) return { data: listingHtml };
      if (url === winner) {
        return { data: '<html><head><meta property="og:title" content="August Patch"></head><body><article>notes</article></body></html>' };
      }
      throw new Error(`unexpected article url ${url}`);
    },
    safeCheerioLoad: (html: unknown) => cheerio.load(String(html || "")),
    cleanText: (value: unknown) => String(value || "").replace(/\s+/g, " ").trim(),
    normalizeUpdate,
    logger: () => undefined,
    SchemaDriftError: TestSchemaDriftError
  };
  attachUpdates(context);
  const runtime = context as typeof context & UpdatesRuntime;

  const result = await runtime.fetchListingBasedUpdate({
    key: "vendor",
    name: "Vendor",
    listingUrl,
    baseUrl: "https://example.com",
    articleHrefRegex: "/news/",
    requireKeywords: ["patch", "notes"]
  });

  assert.equal(result.link, winner);
  assert.equal(result.title, "August Patch");
});
