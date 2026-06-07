import test from "node:test";
import assert from "node:assert/strict";

const attachEnv = require("../shared/env") as ((target: unknown) => void) & {
  formatEnvValidationErrors: (err: unknown) => Array<{ variable: string; problem: string }>;
};
const { formatEnvValidationErrors } = attachEnv;

test("formatEnvValidationErrors: mapeaza issue-urile zod la {variable, problem} per secret", () => {
  const zodLikeError = {
    issues: [
      { path: ["DISCORD_TOKEN"], message: "DISCORD_TOKEN lipseste" },
      { path: ["DISCORD_CLIENT_ID"], message: "DISCORD_CLIENT_ID lipseste (necesar pentru slash commands)" },
      { path: ["PORT"], message: "PORT trebuie sa fie intre 1 si 65535" }
    ]
  };
  const out = formatEnvValidationErrors(zodLikeError);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { variable: "DISCORD_TOKEN", problem: "DISCORD_TOKEN lipseste" });
  assert.equal(out[1].variable, "DISCORD_CLIENT_ID");
  assert.match(out[1].problem, /slash commands/);
  assert.equal(out[2].variable, "PORT");
});

test("formatEnvValidationErrors: issue fara path -> (general)", () => {
  const out = formatEnvValidationErrors({ issues: [{ message: "regula custom incalcata" }] });
  assert.equal(out[0].variable, "(general)");
  assert.equal(out[0].problem, "regula custom incalcata");
});

test("formatEnvValidationErrors: eroare non-zod -> fallback pe mesaj", () => {
  const out = formatEnvValidationErrors(new Error("ceva neasteptat"));
  assert.equal(out.length, 1);
  assert.equal(out[0].variable, "(general)");
  assert.equal(out[0].problem, "ceva neasteptat");
});

test("formatEnvValidationErrors: issue fara mesaj -> text implicit", () => {
  const out = formatEnvValidationErrors({ issues: [{ path: ["MONGO_URI"] }] });
  assert.equal(out[0].variable, "MONGO_URI");
  assert.equal(out[0].problem, "valoare invalida");
});
