import test from "node:test";
import assert from "node:assert/strict";
import { buildAutocompleteChoices } from "../native/fuzzy";

// V12: buildAutocompleteChoices fallback (TS) trebuie sa ordoneze tie-urile de
// scor IDENTIC cu Rust `build_autocomplete_choices` (`str::cmp` = ordine
// lexicografica pe codepoints). Inainte fallback-ul folosea localeCompare,
// care e locale-dependent si trateaza case/diacritice diferit → ordinea
// sugestiilor cu scor egal difera intre path-ul nativ (productie) si fallback.
//
// Notă: in CI/local fara addon-ul Rust, buildAutocompleteChoices foloseste
// direct fallback-ul, deci testul exercita exact codul modificat.

test("autocomplete tie-break e ordinal (uppercase inaintea lowercase), nu locale", () => {
  // Input gol → toate jocurile scoreaza 0 (tie pe scor) → tie-break pe nume.
  const games = [
    { key: "k1", name: "banana" },   // 'b' = 98
    { key: "k2", name: "Apple" },    // 'A' = 65
    { key: "k3", name: "Cherry" }    // 'C' = 67
  ];
  const choices = buildAutocompleteChoices(games, "", false, 20, 25, 100, 100);
  const order = choices.map(c => c.name.split(" ")[0]);
  // Ordinal (codepoint): Apple(65), Cherry(67), banana(98).
  // localeCompare (en) ar fi dat: Apple, banana, Cherry (case-insensitive a,b,c).
  assert.deepEqual(order, ["Apple", "Cherry", "banana"],
    "tie-break trebuie sa fie ordinal pe codepoints, NU localeCompare");
});

test("autocomplete: scor mai mare castiga inaintea tie-break-ului pe nume", () => {
  const games = [
    { key: "zzz", name: "zzz exact match target" },
    { key: "cs2", name: "Counter-Strike 2", aliases: ["cs2match"] }
  ];
  // Input "cs2" → exact key match pe cs2 (scor 100), zzz scor 0/-1.
  const choices = buildAutocompleteChoices(games, "cs2", false, 20, 25, 100, 100);
  assert.ok(choices.length >= 1);
  assert.match(choices[0].name, /Counter-Strike 2/, "match-ul cu scor mare e primul");
});

test("autocomplete: value=key default, value=name cand useNameAsValue", () => {
  const games = [{ key: "cs2", name: "Counter-Strike 2" }];
  const byKey = buildAutocompleteChoices(games, "cs", false, 20, 25, 100, 100);
  assert.equal(byKey[0].value, "cs2");
  const byName = buildAutocompleteChoices(games, "cs", true, 20, 25, 100, 100);
  assert.equal(byName[0].value, "Counter-Strike 2");
});

test("autocomplete: respecta maxChoices", () => {
  const games = Array.from({ length: 50 }, (_, i) => ({ key: `g${i}`, name: `Game ${i}` }));
  const choices = buildAutocompleteChoices(games, "", false, 20, 5, 100, 100);
  assert.equal(choices.length, 5, "trebuie limitat la maxChoices");
});

test("autocomplete: ordinea e deterministica intre rulari identice", () => {
  const games = [
    { key: "a", name: "Alpha" },
    { key: "b", name: "alpha" },
    { key: "c", name: "ALPHA" }
  ];
  const run1 = buildAutocompleteChoices(games, "", false, 20, 25, 100, 100).map(c => c.value);
  const run2 = buildAutocompleteChoices(games, "", false, 20, 25, 100, 100).map(c => c.value);
  assert.deepEqual(run1, run2, "acelasi input → aceeasi ordine de fiecare data");
  // Ordinal: "ALPHA"(A,L,P,H,A toate upper), "Alpha", "alpha" — upper before lower.
  const order = buildAutocompleteChoices(games, "", false, 20, 25, 100, 100).map(c => c.name.split(" ")[0]);
  assert.equal(order[0], "ALPHA", "ALPHA (toate uppercase) ordinal primul");
});
