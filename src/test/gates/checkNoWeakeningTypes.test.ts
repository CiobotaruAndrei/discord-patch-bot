import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import os from "os";
import path from "path";
const mod = require("../../scripts/check-no-weakening-types") as {
  findWeakeningTypes: (text: string, fileName?: string) => Array<{ line: number; kind: string; text: string }>;
  collectWeakeningViolations: (files: string[]) => Array<{ file: string; line: number; kind: string; text: string }>;
  canUseWeakeningTypes: (file: string) => boolean;
  isBugCatchingRel: (rel: string) => boolean;
};
const { findWeakeningTypes, collectWeakeningViolations, canUseWeakeningTypes, isBugCatchingRel } = mod;

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

test("gate-ul nu exclude toate testele, ci doar allowlist-ul explicit pentru testul scannerului", () => {
  const allowed = path.join(process.cwd(), "test", "gates", "checkNoWeakeningTypes.test.ts");
  const normalTest = path.join(process.cwd(), "test", "mongoContextTypedApi.test.ts");
  assert.equal(canUseWeakeningTypes(allowed), true, "doar testul dedicat scannerului are voie sa contina fixture-uri deliberate");
  assert.equal(canUseWeakeningTypes(normalTest), false, "restul testelor sunt scanate ca fisiere sursa normale");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weakening-gate-"));
  const tempFile = path.join(tempDir, "bad.test.ts");
  try {
    fs.writeFileSync(tempFile, "const value: any = 1;\n");
    const violations = collectWeakeningViolations([tempFile]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "any");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("allowlist-ul nu depinde de directorul de rulare: accepta `test/...` si `src/test/...`", () => {
  assert.equal(isBugCatchingRel(path.join("test", "gates", "checkNoWeakeningTypes.test.ts")), true,
    "rulat din src/ (rel = test/checkNoWeakeningTypes.test.ts)");
  assert.equal(isBugCatchingRel(path.join("src", "test", "gates", "checkNoWeakeningTypes.test.ts")), true,
    "rulat din root-ul repo (rel = src/test/checkNoWeakeningTypes.test.ts)");
  assert.equal(isBugCatchingRel(path.join("test", "mongoContextTypedApi.test.ts")), false,
    "un test normal nu e allowlistat");
  assert.equal(isBugCatchingRel(path.join("src", "test", "mongoContextTypedApi.test.ts")), false,
    "nici prefixat cu src/ nu allowlisteaza un test normal");
});
