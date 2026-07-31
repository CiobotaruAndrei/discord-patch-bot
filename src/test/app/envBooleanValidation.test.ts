import test from "node:test";
import attachEnv from "../../shared/env.js";
import assert from "node:assert/strict";
import type { z as ZodNamespace, ZodTypeAny } from "zod";

const { makeOptionalBooleanEnv } = attachEnv;

import { z } from "zod";

function schema(name: string): ZodTypeAny {
  return makeOptionalBooleanEnv(z, name);
}

test("makeOptionalBooleanEnv: accepta valorile booleene documentate (true/false/1/0, case-insensitive)", () => {
  const s = schema("NOTIFICATION_OUTBOX_ENABLED");
  for (const value of ["true", "false", "1", "0", "TRUE", "False"]) {
    assert.equal(s.safeParse(value).success, true, `"${value}" este o valoare booleana valida`);
  }
});

test("makeOptionalBooleanEnv: respinge un typo (treu) in loc sa-l trateze silentios ca false", () => {
  const s = schema("MIGRATIONS_CONTINUE_ON_ERROR");
  assert.equal(s.safeParse("treu").success, false, "un typo trebuie sa pice fail-fast, nu sa devina false");
  assert.equal(s.safeParse("yes").success, false, "doar true/false/1/0 sunt acceptate");
  assert.equal(s.safeParse("2").success, false, "numerele in afara de 1/0 sunt invalide");
});

test("makeOptionalBooleanEnv: trateaza undefined si string gol ca neset (foloseste default-ul)", () => {
  const s = schema("ALLOW_DEFAULT_PROXIES");
  assert.equal(s.safeParse(undefined).success, true, "variabila neset este permisa (optional)");
  assert.equal(s.safeParse("").success, true, "FOO= (gol) este tratat ca neset, nu ca eroare");
});

test("makeOptionalBooleanEnv: mesajul de eroare numeste variabila si valorile permise", () => {
  const parsed = schema("METRICS_PUBLIC").safeParse("treu");
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.issues[0].message, /METRICS_PUBLIC trebuie sa fie true\/false\/1\/0/);
  }
});
