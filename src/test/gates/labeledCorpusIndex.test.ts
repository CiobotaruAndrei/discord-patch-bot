import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();

function readNative(...parts: string[]): string {
  return fs.readFileSync(path.join(srcRoot, "native", "core", ...parts), "utf8");
}

test("indexul de mostre etichetate e versionat", () => {
  const module = readNative("src", "similarity_corpus.rs");
  assert.match(
    module,
    /LABELED_CORPUS_VERSION: u32 = \d+/,
    "documentul cere un corpus versionat; fara versiune nu se poate spune fata de ce s-a comparat"
  );
});

test("fiecare mostra din index are eticheta verificata si amprenta", () => {
  const module = readNative("src", "similarity_corpus.rs");
  const entries = module.match(/LabeledSample \{ id: [^}]+\}/g) ?? [];
  assert.ok(entries.length >= 17, `mostre in index: ${entries.length}`);
  for (const entry of entries) {
    assert.match(entry, /id: "[^"]+"/, `mostra fara identitate: ${entry}`);
    assert.match(entry, /category: "[^"]+"/, `mostra fara categorie: ${entry}`);
    assert.match(entry, /hostile: (true|false)/, `mostra fara eticheta verificata: ${entry}`);
    assert.match(entry, /sha256: "[a-f0-9]{64}"/, `mostra fara amprenta: ${entry}`);
  }
  assert.ok(entries.some(entry => entry.includes("hostile: true")), "un index fara mostre ostile nu e baza de comparatie");
  assert.ok(entries.some(entry => entry.includes("hostile: false")), "fara mostre beningne nu se pot vedea fals-pozitivele");
});

test("corpusul inghetat si indexul nu se pot despartii", () => {
  const tests = readNative("tests", "regression_corpus.rs");
  assert.ok(
    tests.includes("fiecare_esantion_inghetat_exista_in_indexul_etichetat"),
    "daca cele doua se despart, indexul devine o lista de amprente fara acoperire in mostre reale"
  );
});
