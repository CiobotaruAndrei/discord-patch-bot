import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import {
  decodeMinecraftManifest,
  decodeRobloxVersion,
  decodeSteamFeaturedCategories,
  decodeSteamNewsResponse,
  decodeSteamReviewResponse
} from "../../sources/responseDecoders.js";

test("un raspuns cu forma gresita nu mai devine tacit un obiect intern", () => {
  assert.deepEqual(decodeSteamReviewResponse({ query_summary: "nu e obiect" }), {});
  assert.deepEqual(decodeMinecraftManifest({ latest: 42 }), {});
  assert.deepEqual(decodeRobloxVersion({ clientVersionUpload: 7 }), {});
  assert.deepEqual(decodeSteamNewsResponse({ appnews: { newsitems: "nu e lista" } }), {});
  assert.deepEqual(decodeSteamFeaturedCategories({ specials: { items: [{ fara: "id" }] } }), {},
    "un element fara `id` invalideaza lista; inainte castul il lasa sa treaca si abia mai tarziu producea nedefinit");
});

test("un raspuns valid isi pastreaza campurile, inclusiv cele necunoscute", () => {
  const review = decodeSteamReviewResponse({ query_summary: { total_reviews: 10, total_positive: 8 }, extra: 1 });
  assert.equal(review.query_summary?.total_reviews, 10);

  const specials = decodeSteamFeaturedCategories({ specials: { items: [{ id: 570, name: "Dota", discount_percent: 50 }] } });
  assert.equal(specials.specials?.items?.[0].discount_percent, 50);

  const news = decodeSteamNewsResponse({ appnews: { newsitems: [{ title: "Patch", url: "https://x.test" }] } });
  assert.equal(news.appnews?.newsitems?.[0].title, "Patch");
});

test("null si tipurile primitive nu mai trec drept raspuns", () => {
  for (const decoder of [decodeSteamReviewResponse, decodeMinecraftManifest, decodeRobloxVersion, decodeSteamNewsResponse, decodeSteamFeaturedCategories]) {
    assert.deepEqual(decoder(null), {});
    assert.deepEqual(decoder("text"), {});
    assert.deepEqual(decoder(7), {});
  }
});

test("sursele nu mai transforma raspunsuri externe prin cast", () => {
  const fisiere = [
    path.join("sources", "deals", "steamDeals.ts"),
    path.join("sources", "updates", "platformUpdates.ts"),
    path.join("sources", "updates", "steamUpdates.ts")
  ];
  for (const relativ of fisiere) {
    const text = fs.readFileSync(path.join(process.cwd(), relativ), "utf8");
    const casturi = text.match(/\b(?:raw|res\.data|steamRes\.data|detailsRes\.data) as [A-Z]\w+/g) ?? [];
    assert.deepEqual(
      casturi,
      [],
      `${relativ} converteste un raspuns HTTP direct intr-un tip intern. Un cast nu verifica nimic la rulare: ` +
        "daca API-ul isi schimba forma, obiectul gresit curge mai departe si esueaza abia unde nu se mai vede cauza"
    );
  }
});
