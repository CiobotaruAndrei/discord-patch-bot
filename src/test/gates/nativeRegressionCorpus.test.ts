import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";
import { nativeCheckCommands } from "../../scripts/check-native.js";

const srcRoot = process.cwd();
const corpusPath = path.join(srcRoot, "native", "core", "tests", "regression_corpus.rs");

function readCorpus(): string {
  return fs.readFileSync(corpusPath, "utf8");
}

test("corpusul de regresie exista si e rulat de check:native prin pachetul core", () => {
  assert.ok(fs.existsSync(corpusPath), "native/core/tests/regression_corpus.rs exista");
  const checkNative = nativeCheckCommands("x86_64-unknown-linux-gnu").map(args => args.join(" ")).join(" ");
  assert.ok(
    checkNative.includes("-p discord_patch_bot_logic"),
    "corpusul traieste in pachetul core; daca pachetul iese din check:native, corpusul nu mai ruleaza la niciun PR"
  );
});

test("corpusul acopera toate cele patru categorii cerute de PDF: arhive, PDF-uri, executabile, imagini QR", () => {
  const source = readCorpus();
  for (const category of ["arhiva", "pdf", "executabil", "qr"]) {
    assert.match(
      source,
      new RegExp(`category: "${category}"`),
      `categoria "${category}" a disparut din corpus — exact tipul de continut pe care PDF-ul cere sa-l acopere`
    );
  }
});

test("fiecare esantion din corpus are o amprenta SHA-256 fixata, nu un placeholder", () => {
  const source = readCorpus();
  const samples = source.match(/category: "/g) ?? [];
  const digests = source.match(/digest: "[0-9a-f]{64}"/g) ?? [];
  assert.ok(samples.length >= 15, `corpusul are cel putin 15 esantioane, nu ${samples.length}`);
  assert.equal(
    digests.length,
    samples.length,
    "un esantion fara amprenta hex completa nu poate dovedi ca octetii lui nu s-au schimbat"
  );
  assert.equal(new Set(digests).size, digests.length, "doua esantioane cu aceeasi amprenta inseamna octeti duplicati");
});

test("corpusul verifica si absenta indicatorilor pe esantioanele benigne, nu doar prezenta pe cele ostile", () => {
  const source = readCorpus();
  assert.match(source, /benign: true/, "fara esantioane benigne, o regresie de fals-pozitiv trece nevazuta");
  assert.match(source, /forbidden:/, "esantioanele benigne isi declara indicatorii interzisi");
  assert.match(
    source,
    /fiecare_categorie_ceruta_are_si_un_esantion_ostil_si_unul_benign/,
    "testul care impune perechea ostil+benign per categorie exista"
  );
});
