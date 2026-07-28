import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const inspectionPath = path.join(srcRoot, "native", "core", "src", "inspection.rs");

function readInspection(): string {
  return fs.readFileSync(inspectionPath, "utf8");
}

test("containerele fara decodor sunt recunoscute dupa octeti, nu dupa metadate", () => {
  const source = readInspection();
  const signatures = source.slice(source.indexOf("fn container_signature"));
  const body = signatures.slice(0, signatures.indexOf("\nfn "));
  for (const [label, magic] of [
    ["CAB", "0x4d, 0x53, 0x43, 0x46"],
    ["CHM", "0x49, 0x54, 0x53, 0x46"],
    ["SZDD", "0x53, 0x5a, 0x44, 0x44"],
    ["KWAJ", "0x4b, 0x57, 0x41, 0x4a"]
  ]) {
    assert.ok(
      body.includes(magic),
      `semnatura ${label} lipseste; fara ea, formatul e recunoscut doar dupa numele si MIME-ul alese de expeditor`
    );
  }
});

test("detectia de arhiva consulta semnaturile inaintea numelui si a MIME-ului", () => {
  const source = readInspection();
  const detector = source.slice(source.indexOf("fn looks_like_archive"));
  const body = detector.slice(0, detector.indexOf("\nfn "));
  const signatureAt = body.indexOf("container_signature(bytes)");
  const nameAt = body.indexOf("filename.to_lowercase()");
  assert.notEqual(signatureAt, -1, "looks_like_archive trebuie sa consulte semnaturile de continut");
  assert.ok(
    signatureAt < nameAt,
    "un CAB redenumit document.dat cu MIME generic trecea ca inspectat si curat; " +
      "continutul trebuie verificat inaintea metadatelor pe care le alege expeditorul"
  );
});

test("extensiile containerelor fara decodor raman in lista recunoscuta", () => {
  const source = readInspection();
  for (const extension of [".cab", ".chm", ".zst", ".lz4"]) {
    assert.ok(
      source.includes(`"${extension}"`),
      `${extension} a iesit din lista de extensii de arhiva, desi formatul nu are decodor pasiv local`
    );
  }
});
