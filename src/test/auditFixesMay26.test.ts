import test from "node:test";
import assert from "node:assert/strict";

test("sources/updates: fetchListingBasedUpdate aruncă Error (nu SchemaDriftError) pe transient fail", async () => {

  const fs = require("node:fs");
  const path = require("node:path");

  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "sources", "updates", "index.ts"),
    "utf8"
  );
  const fnStart = src.indexOf("async function fetchListingBasedUpdate");
  assert.ok(fnStart > 0, "fetchListingBasedUpdate trebuie sa existe");

  const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  const driftThrows = (fnBody.match(/throw new SchemaDriftError/g) || []).length;
  assert.equal(driftThrows, 1, "DOAR un singur SchemaDriftError throw (pentru 0 ancore reale)");

  assert.match(fnBody, /throw new Error\([\s\S]*?Niciun articol/,
    "loop-ul de candidati trebuie sa arunce plain Error, nu SchemaDriftError");
});

test("native/fuzzy fallback: findGameKeysFallback foloseste Array.from pentru codepoints", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "native", "fuzzy.ts"),
    "utf8"
  );
  const fnStart = src.indexOf("function findGameKeysFallback");
  assert.ok(fnStart > 0);
  const fnEnd = src.indexOf("\nexport function ", fnStart);
  const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  assert.match(fnBody, /Array\.from\(search\)/,
    "fallback trebuie sa numere si trunchieze pe codepoints, nu UTF-16 units");
  assert.match(fnBody, /searchLen \* 0\.3/,
    "pragul dinamic trebuie sa foloseasca searchLen (codepoints), nu .length");
});

test("native/fuzzy fallback: findGameKeys cu input mixed-emoji nu crash", () => {

  const { findGameKeys } = require("../native/fuzzy") as typeof import("../native/fuzzy");
  const games = [
    { key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] },
    { key: "fortnite", name: "Fortnite", aliases: [] }
  ];

  const result = findGameKeys("\u{1F600}cs2", games, 50);
  assert.ok(result, "trebuie sa returneze un obiect (gameKey/suggestionKey)");
});

test("validatePendingDiscountSnapshot: accepta savings ca numar finit", () => {
  const attachUtilities = require("../shared/utilities") as any;
  const validatePendingDiscountSnapshot = attachUtilities.validatePendingDiscountSnapshot as (s: unknown) => boolean;
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

test("validatePendingDiscountSnapshot: pastreaza restul validarilor stricte", () => {
  const attachUtilities = require("../shared/utilities") as any;
  const validatePendingDiscountSnapshot = attachUtilities.validatePendingDiscountSnapshot as (s: unknown) => boolean;
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

test("checkForUpdates: setUpdatesCache NU se cheama pe subset filtrat", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "features", "notifications", "updateNotificationService.ts"),
    "utf8"
  );

  assert.match(src,
    /if\s*\(\s*optimizedGames\.length\s*===\s*games\.length\s*\)\s*\{[\s\S]*?setUpdatesCache/,
    "setUpdatesCache trebuie chemat doar in branch-ul `length === length`");
});
