import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSteamSearchResponse,
  decodeSteamDetailsResponse,
  decodeEpicGraphqlResponse,
  decodeFortniteBlogResponse
} from "../../sources/responseDecoders.js";

test("decodeSteamSearchResponse extrage items valide si copiaza fiecare intrare", () => {
  const decoded = decodeSteamSearchResponse({ items: [{ name: "Portal", type: "app", id: 400 }], extra: "ignored" });
  assert.deepEqual(decoded.items?.map(item => item.name), ["Portal"]);
  assert.equal((decoded.items?.[0] as { type?: string }).type, "app");
});

test("decodeSteamDetailsResponse pastreaza maparea appId -> data", () => {
  const decoded = decodeSteamDetailsResponse({ "400": { data: { name: "Portal", is_free: false } } });
  assert.equal(decoded["400"]?.data?.name, "Portal");
});

test("decodeEpicGraphqlResponse coboara pana la elemente si le tipeaza", () => {
  const decoded = decodeEpicGraphqlResponse({ data: { Catalog: { searchStore: { elements: [{ title: "Fortnite", price: { totalPrice: { discountPrice: 0 } } }] } } } });
  assert.equal(decoded.data?.Catalog?.searchStore?.elements?.[0]?.title, "Fortnite");
});

test("decodeFortniteBlogResponse extrage blogList", () => {
  const decoded = decodeFortniteBlogResponse({ blogList: [{ slug: "patch", title: "Patch 1" }] });
  assert.equal(decoded.blogList?.[0]?.slug, "patch");
});

test("decoderele nu arunca pe input malformat, intorc forma goala (safeParse, comportament non-throwing pastrat)", () => {
  for (const decode of [decodeSteamSearchResponse, decodeEpicGraphqlResponse, decodeFortniteBlogResponse, decodeSteamDetailsResponse]) {
    assert.doesNotThrow(() => decode(null));
    assert.doesNotThrow(() => decode("string in loc de obiect"));
    assert.doesNotThrow(() => decode(42));
  }
  assert.deepEqual(decodeSteamSearchResponse({ items: "nu e array" }), {}, "un camp de tip gresit nu mai arunca (vs .parse), ci degradeaza la gol");
  assert.deepEqual(decodeFortniteBlogResponse(null).blogList, undefined);
});
