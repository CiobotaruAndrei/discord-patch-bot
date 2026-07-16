import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

test("steam, deals si updates expun DOAR fabrici cu deps explicite: fara contexte Partial<Api>, fara Record dinamic, cu deps snapshot-uite (review nou, Major #7)", () => {
  const steam = readSource("sources/steam/index.ts");
  const deals = readSource("sources/deals/index.ts");
  const updatesContracts = readSource("sources/updates/updatesContracts.ts");
  const updates = readSource("sources/updates/index.ts");

  assert.ok(!steam.includes("SteamSourceDeps & Record<string, unknown>"));
  assert.ok(!deals.includes("DealsDeps & Record<string, unknown>"));
  assert.ok(!updatesContracts.includes("UpdatesDeps & Record<string, unknown>"));

  assert.ok(!/Partial<SteamSourceApi>/.test(steam), "steam nu mai are context progresiv Partial<SteamSourceApi>");
  assert.ok(!/Partial<DealsApi>/.test(deals), "deals nu mai are context progresiv Partial<DealsApi>");
  assert.ok(!/Partial<UpdatesApi>/.test(updatesContracts), "updates nu mai are context progresiv Partial<UpdatesApi>");
  assert.ok(!steam.includes("buildFrom") && !deals.includes("buildFrom") && !updates.includes("buildFrom"),
    "wrapper-ele buildFrom au disparut: familiile se construiesc DOAR prin fabricile lor cu deps explicite");

  assert.match(steam, /function createSteamSource\(deps: SteamSourceDeps\): SteamSourceApi/, "SteamSource are contract propriu");
  assert.match(deals, /function createDeals\(d: DealsDeps\): DealsApi/, "DealsSource are contract propriu");
  assert.match(updates, /function createUpdates\(d: UpdatesDeps\): UpdatesApi/, "UpdatesSource are contract propriu");

  assert.match(updates, /const deps = \{ \.\.\.d \};/, "createUpdates isi snapshot-uieste deps-urile: o mutatie tarzie a obiectului apelantului nu se scurge in fabrica");
  assert.match(deals, /const deps = \{ \.\.\.d \};/, "createDeals isi snapshot-uieste deps-urile");
});
