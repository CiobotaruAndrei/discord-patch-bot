import test from "node:test";
import assert from "node:assert/strict";

import { decodeSteamDetailsResponse, decodeStatusPageResponse } from "../../sources/responseDecoders.js";

test("un raspuns Steam cu forma neasteptata nu mai trece ca payload valid", () => {
  assert.deepEqual(decodeSteamDetailsResponse(null), {});
  assert.deepEqual(decodeSteamDetailsResponse("nu e obiect"), {});
  assert.deepEqual(decodeSteamDetailsResponse([1, 2, 3]), {});
});

test("platformele Steam ajung tipate, iar cele invalide sunt lasate afara", () => {
  const decoded = decodeSteamDetailsResponse({
    "730": { data: { name: "CS2", platforms: { windows: true, mac: false, linux: true } } }
  });
  assert.equal(decoded["730"]?.data?.name, "CS2");
  assert.deepEqual(decoded["730"]?.data?.platforms, { windows: true, mac: false, linux: true });

  const wrongTypes = decodeSteamDetailsResponse({ "730": { data: { platforms: { windows: "da" } } } });
  assert.equal(wrongTypes["730"], undefined, "un camp cu tip gresit invalideaza intrarea, nu produce un boolean inventat");
});

test("pagina de status se decodeaza, iar un raspuns strain devine obiect gol in loc de acces pe undefined", () => {
  assert.deepEqual(decodeStatusPageResponse({ status: { indicator: "major", description: "Down" } }), {
    status: { indicator: "major", description: "Down" }
  });
  assert.deepEqual(decodeStatusPageResponse(null), {});
  assert.deepEqual(decodeStatusPageResponse({ status: "online" }), {}, "un status care nu e obiect nu se citeste ca indicator");
  assert.deepEqual(decodeStatusPageResponse({}), {});
});

test("campurile necunoscute din raspuns nu blocheaza decodarea", () => {
  const decoded = decodeStatusPageResponse({ status: { indicator: "none" }, page: { id: "x" } });
  assert.equal(decoded.status?.indicator, "none");
});
