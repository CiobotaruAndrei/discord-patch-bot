import test from "node:test";
import assert from "node:assert/strict";
import { assertNoUndefinedExports } from "../shared/assertCompleteExports";

test("assertNoUndefinedExports: intoarce acelasi obiect cand toate valorile sunt definite", () => {
  const exportsObj = { a: 1, b: "x", c: () => 0, d: false, e: 0, f: "" };
  const result = assertNoUndefinedExports(exportsObj, "test");
  assert.equal(result, exportsObj);
});

test("assertNoUndefinedExports: arunca si listeaza cheile cu valoare undefined", () => {
  const exportsObj = { ok: 1, lipsa1: undefined, alta: 2, lipsa2: undefined };
  assert.throws(
    () => assertNoUndefinedExports(exportsObj, "mongoContext"),
    (err: unknown) => {
      const message = (err as Error).message;
      assert.match(message, /mongoContext/);
      assert.match(message, /lipsa1/);
      assert.match(message, /lipsa2/);
      assert.doesNotMatch(message, /\bok\b/);
      return true;
    }
  );
});

test("assertNoUndefinedExports: valori falsy (0, '', false, null) NU sunt tratate ca lipsa", () => {
  const exportsObj = { zero: 0, gol: "", fals: false, nul: null };
  assert.doesNotThrow(() => assertNoUndefinedExports(exportsObj, "test"));
});
