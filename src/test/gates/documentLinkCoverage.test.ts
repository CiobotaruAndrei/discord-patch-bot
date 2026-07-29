import test from "node:test";
import assert from "node:assert/strict";
import { readInspectionSources } from "./nativeInspectionSources.js";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const inspection = readInspectionSources();

function corp(numeFunctie: string): string {
  const start = inspection.indexOf(`fn ${numeFunctie}`);
  assert.notEqual(start, -1, `functia ${numeFunctie} lipseste`);
  const rest = inspection.slice(start);
  return rest.slice(0, rest.indexOf("\nfn "));
}

test("adresele din text sunt cautate pe ambele cai prin care ajunge un document", () => {
  assert.ok(
    corp("content_indicators").includes("text_link_indicators(bytes)"),
    "calea continutului imbricat acopera intrarile de arhiva, deci si partile unui document Office"
  );
  assert.ok(
    corp("document_finding").includes("text_link_indicators(bytes)"),
    "un HTML trimis direct nu trece prin calea de arhiva; fara asta ar ramane necontrolat"
  );
});

test("cautarea de adrese e plafonata si nu porneste pe continut binar", () => {
  const body = corp("text_link_indicators");
  assert.ok(body.includes("TEXT_LINK_SCAN_BYTES"), "textul vine din continut netrusted, deci are nevoie de plafon");
  assert.ok(
    body.includes('slice == b"http"'),
    "fara un filtru ieftin inainte, fiecare fisier binar ar fi convertit degeaba in text"
  );
});

test("acoperirea pentru Office si HTML are teste proprii", () => {
  const tests = fs.readFileSync(
    path.join(srcRoot, "native", "core", "tests", "text_links_office_html.rs"),
    "utf8"
  );
  for (const name of [
    "un_docx_cu_adresa_de_phishing_in_text_nu_mai_trece_curat",
    "un_html_trimis_direct_e_tratat_la_fel",
    "continutul_binar_fara_text_nu_declanseaza_cautarea"
  ]) {
    assert.ok(tests.includes(name), `lipseste testul ${name}`);
  }
});
