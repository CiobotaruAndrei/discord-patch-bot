import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

test("deal filter installer foloseste exporturile reale ca target partial", () => {
  const source = readSource("domain/deals/filters.ts");

  assert.ok(!source.includes("type DealFiltersContext = Record<string, unknown>"));
  assert.match(source, /type DealFiltersContext = Partial<typeof dealFilterExports>/);
});
