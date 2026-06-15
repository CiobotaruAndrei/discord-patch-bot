import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const mod = require("../scripts/check-no-weakening-types") as {
  findWeakeningTypes: (text: string, fileName?: string) => Array<{ line: number; kind: string; text: string }>;
};
const { findWeakeningTypes } = mod;

test("detecteaza dubla asertiune `as unknown as`", () => {
  const violations = findWeakeningTypes("const x = foo as unknown as Bar;");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "as unknown as");
});

test("detecteaza `as never`", () => {
  const violations = findWeakeningTypes("const x = foo as never;");
  assert.equal(violations.some(v => v.kind === "as never"), true);
});

test("detecteaza `any` in adnotari, cast-uri, type args si array-uri", () => {
  assert.equal(findWeakeningTypes("function f(x: any) { return x; }").some(v => v.kind === "any"), true);
  assert.equal(findWeakeningTypes("const x = foo as any;").some(v => v.kind === "any"), true);
  assert.equal(findWeakeningTypes("const xs: Array<any> = [];").some(v => v.kind === "any"), true);
  assert.equal(findWeakeningTypes("const xs: any[] = [];").some(v => v.kind === "any"), true);
});

test("NU flag `unknown` singur (tipul top, type-safe)", () => {
  assert.deepEqual(findWeakeningTypes("function f(x: unknown) { return x; }"), []);
  assert.deepEqual(findWeakeningTypes("let v: unknown; const s = String(v);"), []);
});

test("NU flag narrowing-ul `as Record<string, unknown>` / `as TipReal` (ingusteaza, nu slabeste)", () => {
  assert.deepEqual(findWeakeningTypes("const r = value as Record<string, unknown>;"), []);
  assert.deepEqual(findWeakeningTypes("const d = item as DealInfo;"), []);
  assert.deepEqual(findWeakeningTypes("const n = raw as string | number;"), []);
});

test("NU flag typed-require `as typeof import(...)`", () => {
  assert.deepEqual(findWeakeningTypes('const ts = require("typescript") as typeof import("typescript");'), []);
});

test("gate pe cod real: un fisier de productie narrowing-heavy nu are constructii care slabesc tiparea", () => {
  const file = path.join(process.cwd(), "features", "notifications", "notificationOutbox.ts");
  const text = fs.readFileSync(file, "utf8");
  assert.deepEqual(findWeakeningTypes(text), [],
    "notificationOutbox.ts foloseste doar narrowing (as Record<string, unknown>), nu any/as never/as unknown as");
});
