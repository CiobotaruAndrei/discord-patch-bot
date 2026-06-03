import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const repoRoot = path.resolve(process.cwd(), "..");
const readmePath = path.join(repoRoot, "README.md");

function read(): string {
  return fs.readFileSync(readmePath, "utf8");
}

test("README descrie migrarea de arhitectura ca finalizata, nu in curs", () => {
  const text = read();
  assert.doesNotMatch(text, /intr-o migrare controlata/i,
    "README nu mai trebuie sa prezinte arhitectura ca o migrare in curs (formulare stale)");
  assert.match(text, /migrarea[^.]*este \*\*finalizata\*\*/i,
    "README afirma explicit ca migrarea spre factory-uri cu deps tipate este finalizata");
});

test("README descrie tiparul de factory cu deps explicit tipate si adaptorul subtire", () => {
  const text = read();
  assert.match(text, /createX\(deps: XDeps\): XApi/, "documenteaza forma factory-ului tipat");
  assert.match(text, /attachX\(target\)/, "documenteaza adaptorul subtire de compatibilitate");
  assert.match(text, /CommandRuntime/, "mentioneaza contractele tipate de injectie la boot");
  assert.match(text, /ScraperRuntime/, "mentioneaza ScraperRuntime");
});

test("README nu mai listeaza reducerea target-ului comun ca zona ramasa, ci ca exceptii intentionate", () => {
  const text = read();
  assert.doesNotMatch(text, /reducerea target-ului comun din runtime\/registry/i,
    "claim-ul stale despre reducerea target-ului comun nu mai trebuie sa apara");
  assert.match(text, /Singurele[^.]*intentionate/i,
    "README cadreaza Record<string, unknown>-urile ramase ca exceptii intentionate");
  assert.match(text, /CommandRegistryContext/, "numeste punga de wiring ramasa intentionat dinamica");
});

test("README descrie folosirea Rust aliniat la BENCHMARKS.md (autocomplete/deal-filters sunt TS-primary)", () => {
  const text = read();
  const nativeBullet = text.split("\n").find(line => line.includes("`src/native/`")) || "";
  assert.ok(nativeBullet.length > 0, "exista bullet-ul despre src/native/");
  assert.match(nativeBullet, /TS-primary/, "bullet-ul marcheaza zonele mutate in TS ca TS-primary");
  assert.match(nativeBullet, /buildAutocompleteChoices|autocomplete scoring/, "autocomplete scoring e mentionat ca TS-primary, nu Rust pe productie");
  assert.match(nativeBullet, /dealPassesFilters|filtrarea ofertelor/, "filtrarea ofertelor e mentionata ca TS-primary, nu Rust pe productie");
  assert.match(nativeBullet, /benchmark si testele de paritate/, "explica de ce functiile native echivalente raman expuse");
});
