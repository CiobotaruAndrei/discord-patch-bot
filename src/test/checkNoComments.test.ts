import test from "node:test";
import assert from "node:assert/strict";

const checker = require("../scripts/check-no-comments") as {
  findComments: (text: string, ext: string, fileName?: string) => Array<{ line: number; text: string }>;
  findCommentsRust: (text: string) => Array<{ line: number; text: string }>;
  isAllowed: (relFile: string, commentText: string) => boolean;
};

test("findComments: detecteaza comentariu de linie in TS", () => {
  const found = checker.findComments("const a = 1; // explica\n", ".ts", "f.ts");
  assert.equal(found.length, 1);
  assert.match(found[0].text, /\/\/ explica/);
});

test("findComments: detecteaza comentariu bloc in TS", () => {
  const found = checker.findComments("/* doc */\nconst a = 1;\n", ".ts", "f.ts");
  assert.equal(found.length, 1);
  assert.match(found[0].text, /\/\* doc \*\//);
});

test("findComments: NU da fals pozitiv pe regex cu slash", () => {
  const found = checker.findComments("const r = /a\\/b/g;\nconst x = r.test('a/b');\n", ".ts", "f.ts");
  assert.deepEqual(found, [], "slash-urile din regex nu sunt comentarii");
});

test("findComments: NU da fals pozitiv pe URL din string", () => {
  const found = checker.findComments("const u = \"https://example.com//path\";\n", ".ts", "f.ts");
  assert.deepEqual(found, [], "// din string/URL nu e comentariu");
});

test("findComments: cod TS curat -> niciun comentariu", () => {
  const found = checker.findComments("export function f(a: number): number { return a + 1; }\n", ".ts", "f.ts");
  assert.deepEqual(found, []);
});

test("findCommentsRust: detecteaza // si /* */ in Rust", () => {
  const line = checker.findCommentsRust("let a = 1; // nota\n");
  assert.equal(line.length, 1);
  const block = checker.findCommentsRust("/* doc */\nfn f() {}\n");
  assert.equal(block.length, 1);
});

test("findCommentsRust: NU da fals pozitiv pe // dintr-un string Rust", () => {
  const found = checker.findCommentsRust("let s = \"a // not comment\";\n");
  assert.deepEqual(found, []);
});

test("findCommentsRust: cod Rust curat -> niciun comentariu", () => {
  const found = checker.findCommentsRust("fn add(a: i32, b: i32) -> i32 { a + b }\n");
  assert.deepEqual(found, []);
});

test("isAllowed: exceptia documentata din cron.ts este permisa, altele nu", () => {
  const path = require("path") as typeof import("path");
  const cron = path.normalize("app/scheduler/cron.ts");
  assert.equal(checker.isAllowed(cron, "// Re-armam doar cat timp lock-ul e inca al nostru, ca sa nu reinnoim un lock deja eliberat."), true);
  assert.equal(checker.isAllowed(cron, "// alt comentariu nedocumentat"), false);
  assert.equal(checker.isAllowed(path.normalize("features/notifications/index.ts"), "// orice"), false);
});
