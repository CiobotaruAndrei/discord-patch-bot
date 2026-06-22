import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const repoRoot = path.resolve(process.cwd(), "..");
const readmePath = path.join(repoRoot, "README.md");

function read(): string {
  return fs.readFileSync(readmePath, "utf8");
}

test("README descrie migrarea ca finalizata la nivel de factory-uri, cu granitele tiparii explicite", () => {
  const text = read();
  assert.doesNotMatch(text, /intr-o migrare controlata/i,
    "README nu mai trebuie sa prezinte arhitectura ca o migrare in curs (formulare stale)");
  assert.match(text, /migrarea[^.]*este \*\*finalizata la nivel de factory-uri\*\*/i,
    "README afirma exact ce e finalizat (contractele de input ale factory-urilor), nu o curatenie totala");
  assert.match(text, /granitele tiparii/i,
    "README enumera explicit zonele ramase intentionat mai laxe (adaptoare, bag de wiring, payload-uri unknown)");
  assert.doesNotMatch(text, /nu mai foloseste tipuri wildcard nesigure/i,
    "claim-ul absolut despre wildcard-uri (supra-declarare, review #4) nu mai trebuie sa apara");
});

test("README documenteaza politica de imagini Docker si de rebuild (tag-uri mutabile + compensatii)", () => {
  const text = read();
  assert.match(text, /Politica de imagini si rebuild/i, "exista sectiunea de politica Docker");
  assert.match(text, /node:20-bookworm-slim/, "numeste imaginea de baza a botului");
  assert.match(text, /mongo:7/, "numeste imaginea de Mongo");
  assert.match(text, /Trivy/i, "documenteaza scanarea blocanta drept compensatie");
  assert.match(text, /apt-get upgrade/, "documenteaza patch-urile distro la build");
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
  assert.match(text, /RequiredCommandRegistry/, "numeste contractul de export inchis al registrului de comenzi (compunere explicita prin factory-uri, nu punga dinamica)");
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
