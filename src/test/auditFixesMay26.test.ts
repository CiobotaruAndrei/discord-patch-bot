import test from "node:test";
import assert from "node:assert/strict";

// V12: regression guards pentru cele 4 fix-uri din auditul post-PR-120.
// Fiecare fix are un comentariu cu fisierul + scenariul declansator.

// ============================================================================
// Fix #1: fetchListingBasedUpdate transient article fail → plain Error, NU
//   SchemaDriftError. (sources/updates/index.ts:286-324)
//
// Scenariu: listing-ul parseaza OK, primii 3 candidati raspund cu 404/timeout/
// 5xx. Inainte: aruncam SchemaDriftError → pollua schemaDriftFails, declansa
// adminAlert `drift:<game>` si aplica cooldown-ul lung de drift. Acum: plain
// Error → fails normal counter, cooldown CB scurt.
// ============================================================================

test("sources/updates: fetchListingBasedUpdate aruncă Error (nu SchemaDriftError) pe transient fail", async () => {
  // Verificam ca string-ul `SchemaDriftError` NU mai apare in path-ul de
  // network-fail. Citim sursa direct (e cea mai sigura metoda fara sa
  // construim un ctx fake monstruos pentru fetchListingBasedUpdate).
  const fs = require("node:fs");
  const path = require("node:path");
  // __dirname e dist/test la runtime → mergem `../..` la `src/` apoi
  // `sources/updates/index.ts`.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "sources", "updates", "index.ts"),
    "utf8"
  );
  const fnStart = src.indexOf("async function fetchListingBasedUpdate");
  assert.ok(fnStart > 0, "fetchListingBasedUpdate trebuie sa existe");
  // Capata sectiunea functiei.
  const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  // Trebuie sa avem EXACT un singur SchemaDriftError throw — cel pentru "0
  // ancore valide" dupa parse. Cel de la final (transient fail loop) trebuie
  // sa fie un plain Error.
  const driftThrows = (fnBody.match(/throw new SchemaDriftError/g) || []).length;
  assert.equal(driftThrows, 1, "DOAR un singur SchemaDriftError throw (pentru 0 ancore reale)");
  // Cautam textul fix-ului: "plain Error" pe path-ul de loop fail.
  assert.match(fnBody, /throw new Error\([\s\S]*?Niciun articol/,
    "loop-ul de candidati trebuie sa arunce plain Error, nu SchemaDriftError");
});

// ============================================================================
// Fix #3: findGameKeysFallback unicode codepoint count (native/fuzzy.ts:314-358)
//
// Scenariu: Rust addon nu se incarca; user-ul tasteaza un nume cu emoji /
// supplementary-plane chars (CJK >= U+10000). Inainte: search.substring(0, max)
// taia pe UTF-16 code units → split pe pair surogat. Pragul Math.floor(.length
// * 0.3) la fel. Diverge de Rust care foloseste chars().
// ============================================================================

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
  // Smoke test: input cu emoji nu trebuie sa arunce / produce rezultat NaN.
  const { findGameKeys } = require("../native/fuzzy") as typeof import("../native/fuzzy");
  const games = [
    { key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] },
    { key: "fortnite", name: "Fortnite", aliases: [] }
  ];
  // Emoji 4-byte UTF-8 / surrogate pair UTF-16 — daca fallback taia mid-surogat,
  // Levenshtein returna NaN si sortarea exploda.
  const result = findGameKeys("\u{1F600}cs2", games, 50);
  assert.ok(result, "trebuie sa returneze un obiect (gameKey/suggestionKey)");
});

// ============================================================================
// Fix #5: validatePendingDiscountSnapshot accepta savings numeric-coercible
//   (shared/utilities.ts:104-116)
//
// Scenariu: doc-uri Mongo vechi cu `savings` ca string ("33"). Inainte:
// validatorul respingea, snapshot-urile cadeau silent din grace window. Acum
// coerce-uim si validam Number.isFinite.
// ============================================================================

test("validatePendingDiscountSnapshot: accepta savings ca numar finit", () => {
  const attachUtilities = require("../shared/utilities") as any;
  const validatePendingDiscountSnapshot = attachUtilities.validatePendingDiscountSnapshot as (s: unknown) => boolean;
  const base = { title: "Game", store: "Steam", link: "https://x", salePrice: "10", normalPrice: "20" };

  // Number valid.
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: 50 }), true);
  // String numeric (Mongo doc vechi / cast accidental) — V12 acum acceptat.
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: "33" }), true,
    "string numeric-coercible nu mai trebuie respins");
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: "0" }), true);
  // Invalid: NaN, string ne-numeric, undefined, null.
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: NaN }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: "abc" }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: undefined }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, savings: null }), false);
});

test("validatePendingDiscountSnapshot: pastreaza restul validarilor stricte", () => {
  const attachUtilities = require("../shared/utilities") as any;
  const validatePendingDiscountSnapshot = attachUtilities.validatePendingDiscountSnapshot as (s: unknown) => boolean;
  const base = { title: "Game", store: "Steam", link: "https://x", salePrice: "10", normalPrice: "20", savings: 50 };

  // Missing required.
  assert.equal(validatePendingDiscountSnapshot({ ...base, title: undefined }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, title: "" }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, store: undefined }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, link: undefined }), false);
  // sp/np tipuri proaste.
  assert.equal(validatePendingDiscountSnapshot({ ...base, salePrice: {} }), false);
  assert.equal(validatePendingDiscountSnapshot({ ...base, normalPrice: [] }), false);
  // Snapshot null / non-object.
  assert.equal(validatePendingDiscountSnapshot(null), false);
  assert.equal(validatePendingDiscountSnapshot(undefined), false);
  assert.equal(validatePendingDiscountSnapshot("not an object"), false);
});

// ============================================================================
// Fix #7: setUpdatesCache DOAR cand subset == full
//   (notifications/updateNotificationService.ts:192-201)
//
// Scenariu: subset filtrat de buildOptimizedGameList ramane in cache; admin
// face /latest updates pe un guild fara filtru → vede subset incomplet.
// Acum scriem in cache doar la fetch complet.
// ============================================================================

test("checkForUpdates: setUpdatesCache NU se cheama pe subset filtrat", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "features", "notifications", "updateNotificationService.ts"),
    "utf8"
  );
  // Cautam guard-ul `if (optimizedGames.length === games.length) { setUpdatesCache(...) }`.
  assert.match(src,
    /if\s*\(\s*optimizedGames\.length\s*===\s*games\.length\s*\)\s*\{[\s\S]*?setUpdatesCache/,
    "setUpdatesCache trebuie chemat doar in branch-ul `length === length`");
});
