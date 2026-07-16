import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const readmePath = path.join(repoRoot, "README.md");

function read(): string {
  return fs.readFileSync(readmePath, "utf8");
}

test("README descrie compozitia runtime curenta, fara mecanisme eliminate", () => {
  const text = read();
  assert.doesNotMatch(text, /intr-o migrare controlata/i,
    "README nu mai trebuie sa prezinte arhitectura ca o migrare in curs (formulare stale)");
  assert.match(text, /app\/runtimeComposition\.ts/, "README numeste composition root-ul neutru");
  assert.match(text, /SourceRuntimeDeps/, "README documenteaza contractul injectat al surselor");
  assert.doesNotMatch(text, /requireInstalled/, "README nu mai descrie garda eliminata");
  assert.doesNotMatch(text, /nu mai foloseste tipuri wildcard nesigure/i,
    "claim-ul absolut despre wildcard-uri (supra-declarare, review #4) nu mai trebuie sa apara");
});

test("README documenteaza politica de imagini Docker si de rebuild (tag-uri mutabile + compensatii)", () => {
  const text = read();
  assert.match(text, /Politica de imagini si rebuild/i, "exista sectiunea de politica Docker");
  assert.match(text, /node:24-bookworm-slim/, "numeste imaginea de baza a botului");
  assert.match(text, /mongo:7/, "numeste imaginea de Mongo");
  assert.match(text, /Trivy/i, "documenteaza scanarea blocanta drept compensatie");
  assert.match(text, /apt-get upgrade/, "documenteaza patch-urile distro la build");
});

test("README descrie contractele grupate si registrul declarativ complet", () => {
  const text = read();
  assert.match(text, /CommandRuntimeDependencies/, "mentioneaza contractul grupat al comenzilor");
  assert.match(text, /scope.*access.*help.*autocomplete/, "enumera metadatele descriptorului declarativ");
  assert.match(text, /ordinea DECLARARII/, "documenteaza ca dispatch-ul urmeaza ordinea declararii, fara camp priority");
  assert.match(text, /sourceRegistryFactory/, "documenteaza factory-ul pur al surselor");
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
