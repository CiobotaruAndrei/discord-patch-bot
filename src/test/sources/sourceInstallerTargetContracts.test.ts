import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

test("deals si updates isi limiteaza target-ul installer-ului la deps plus api partial", () => {
  const deals = readSource("sources/deals/index.ts");
  const updates = readSource("sources/updates/updatesContracts.ts");

  assert.ok(!deals.includes("DealsDeps & Record<string, unknown>"));
  assert.match(deals, /type DealsContext = DealsDeps & Partial<DealsApi>/);

  assert.ok(!updates.includes("UpdatesDeps & Record<string, unknown>"));
  assert.match(updates, /type UpdatesContext = UpdatesDeps & Partial<UpdatesApi>/);
});
