import test from "node:test";
import assert from "node:assert/strict";
import { readInspectionSources } from "./nativeInspectionSources.js";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");

function readNative(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, "native", relative), "utf8");
}

test("motorul legat este libmspack, nu un cititor scris in Rust", () => {
  const manifest = readNative(path.join("core", "Cargo.toml"));
  assert.match(
    manifest,
    /^mspack-sys = \{ path = "\.\.\/mspack-sys", optional = true \}$/m,
    "un cititor aproximativ ar da alte rezultate exact pe fisierele stricat construite, adica pe cele care conteaza"
  );
  assert.match(manifest, /^default = \[.*"mspack".*\]$/m, "un feature care nu e in default nu apara pe nimeni");

  const build = readNative(path.join("mspack-sys", "build.rs"));
  assert.ok(
    build.includes("bindgen::Builder"),
    "structurile libmspack contin off_t, care are latimi diferite pe Windows si Linux; " +
      "legaturile scrise de mana ar fi corecte pe o platforma si gresite pe cealalta, fara zgomot la compilare"
  );
});

test("decompresia ramane plafonata, fiindca octetii vin de la un expeditor necunoscut", () => {
  const modul = readNative(path.join("core", "src", "mspack_container.rs"));
  for (const plafon of ["max_entries", "max_entry_bytes", "max_total_bytes", "max_name_bytes"]) {
    assert.ok(modul.includes(plafon), `fara ${plafon} o bomba de decompresie poate umple memoria procesului`);
  }
  assert.ok(
    modul.includes("overflow"),
    "cand plafonul taie continutul, raportul trebuie sa spuna; altfel restul analizei crede ca a vazut tot fisierul"
  );
});

test("continutul decomprimat ajunge efectiv in raport, nu se opreste in modul", () => {
  const inspection = readInspectionSources();
  assert.ok(
    inspection.includes("ms_container_indicators"),
    "un decodor care nu e chemat din raport e cod mort care da impresia de acoperire"
  );
  assert.ok(
    /ms_container_indicators\(&entry\.bytes\)|text_link_indicators\(&entry\.bytes\)/.test(inspection),
    "octetii decomprimati trebuie sa treaca prin aceeasi cautare de adrese ca orice alt continut"
  );
});

test("pachetele de sistem sunt cerute peste tot unde se compileaza", () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
  assert.ok(dockerfile.includes("libmspack-dev"), "fara pachetul de build imaginea nu se mai construieste");
  assert.ok(
    dockerfile.includes("libmspack0"),
    "libmspack se leaga dinamic, deci lipsa lui la rulare ar pica abia la pornirea containerului, nu la build"
  );

  const nativePackages = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "native-apt-packages.txt"), "utf8");
  assert.ok(
    nativePackages.split("\n").map(entry => entry.trim()).includes("libmspack-dev"),
    "lista comuna de pachete native trebuie sa contina pachetul de build"
  );

  for (const workflow of ["ci.yml", "native-sanitizers.yml"]) {
    const text = fs.readFileSync(path.join(repoRoot, ".github", "workflows", workflow), "utf8");
    assert.ok(
      text.includes("native-apt-packages.txt"),
      `${workflow} compileaza addon-ul, deci trebuie sa instaleze din aceeasi lista de pachete`
    );
  }

  const windows = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "windows-native.yml"), "utf8");
  assert.ok(windows.includes("libmspack"), "jobul Windows instaleaza prin vcpkg, nu prin apt");
  assert.ok(
    windows.includes("libmagic-libmspack"),
    "cheia de cache vcpkg enumera pachetele; fara actualizare, jobul ar reface un cache care nu contine libmspack"
  );
});

test("libmspack este declarat in inventarul de librarii native", async () => {
  const { NATIVE_COMPONENTS } = await import("../../scripts/native-sbom.js");
  const declarat = NATIVE_COMPONENTS.find(component => component.crate === "mspack-sys");
  assert.ok(declarat, "libmspack se livreaza cu botul, deci apare in inventar ca orice alta librarie C");
  assert.equal(declarat.kind, "c-system", "e legata dinamic la libraria de sistem, nu compilata static in binar");
});
