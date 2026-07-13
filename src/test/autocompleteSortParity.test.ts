import test from "node:test";
import assert from "node:assert/strict";
import { buildAutocompleteChoices } from "../native/fuzzy.js";

test("autocomplete tie-break e ordinal (uppercase inaintea lowercase), nu locale", () => {

  const games = [
    { key: "k1", name: "banana" },
    { key: "k2", name: "Apple" },
    { key: "k3", name: "Cherry" }
  ];
  const choices = buildAutocompleteChoices(games, "", false, 20, 25, 100, 100);
  const order = choices.map(c => c.name.split(" ")[0]);

  assert.deepEqual(order, ["Apple", "Cherry", "banana"],
    "tie-break trebuie sa fie ordinal pe codepoints, NU localeCompare");
});

test("autocomplete: scor mai mare castiga inaintea tie-break-ului pe nume", () => {
  const games = [
    { key: "zzz", name: "zzz exact match target" },
    { key: "cs2", name: "Counter-Strike 2", aliases: ["cs2match"] }
  ];

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

  const order = buildAutocompleteChoices(games, "", false, 20, 25, 100, 100).map(c => c.name.split(" ")[0]);
  assert.equal(order[0], "ALPHA", "ALPHA (toate uppercase) ordinal primul");
});
