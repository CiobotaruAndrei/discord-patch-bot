import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();

function readNative(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, "native", relative), "utf8");
}

test("motorul legat este TLSH-ul original, nu un port in Rust", () => {
  const manifest = readNative(path.join("core", "Cargo.toml"));
  assert.match(
    manifest,
    /^tlsh-sys = \{ path = "\.\.\/tlsh-sys", optional = true \}$/m,
    "crates.io are cel putin cinci reimplementari Rust ale TLSH; niciuna nu e algoritmul de referinta, " +
      "iar o distanta calculata altfel ar face pragurile masurate aici lipsite de sens"
  );
  assert.match(manifest, /^default = \[.*"fuzzy".*\]$/m, "un feature care nu e in default nu apara pe nimeni");

  const build = readNative(path.join("tlsh-sys", "build.rs"));
  assert.ok(build.includes("vendor"), "sursa C++ e vendorizata, nu descarcata la build");
  assert.ok(
    build.includes("WINDOWS"),
    "header-ul TLSH intra pe ramura GCC daca `WINDOWS` nu e definit, iar MSVC nu intelege " +
      "`__attribute__((visibility))`; definitia nu are voie sa dispara"
  );
});

test("sursa vendorizata isi pastreaza licenta si originea", () => {
  const licenta = readNative(path.join("tlsh-sys", "vendor", "LICENSE"));
  assert.match(licenta, /Apache|BSD/, "TLSH se livreaza sub Apache sau BSD; textul licentei merge cu sursa");

  const upstream = readNative(path.join("tlsh-sys", "vendor", "UPSTREAM"));
  assert.match(upstream, /^[0-9a-f]{40}$/m, "commit-ul upstream e fixat, ca sursa vendorizata sa fie verificabila");
  assert.match(upstream, /github\.com\/trendmicro\/tlsh/, "originea sursei trebuie scrisa, nu presupusa");
});

test("pragurile de proximitate raman explicite si separate", () => {
  const modul = readNative(path.join("core", "src", "similarity_hash.rs"));
  assert.ok(modul.includes("near_distance"), "distanta de potrivire apropiata are nevoie de prag propriu");
  assert.ok(modul.includes("related_distance"), "inrudirea e un verdict mai slab decat apropierea, deci alt prag");
  assert.ok(modul.includes("max_input_bytes"), "continutul vine de la un expeditor necunoscut, deci are nevoie de plafon");
});

test("potrivirea aproximativa se aplica doar cand cea exacta nu gaseste nimic", () => {
  const corpus = readNative(path.join("core", "src", "similarity_corpus.rs"));
  assert.ok(
    corpus.includes("return similar_sample_indicators(bytes);"),
    "o mostra identica trebuie raportata ca identica, nu ca apropiata; potrivirea fuzzy e plasa de siguranta de dedesubt"
  );
  assert.ok(
    corpus.includes("pub fuzzy: &'static str"),
    "amprentele fuzzy stau in acelasi index ca cele exacte, ca sa poata fi verificate din aceleasi mostre"
  );
});

test("TLSH este declarat in inventarul de librarii native", async () => {
  const { NATIVE_COMPONENTS } = await import("../../scripts/native-sbom.js");
  const declarat = NATIVE_COMPONENTS.find(component => component.crate === "tlsh-sys");
  assert.ok(declarat, "sursa C++ se compileaza in binarul livrat, deci apare in inventar");
  assert.equal(declarat.kind, "cpp-static", "e compilata static din sursa vendorizata, nu legata la o librarie de sistem");
  assert.match(declarat.vendored, /TLSH/, "inventarul spune ce librarie se livreaza, nu doar numele crate-ului");
});

test("simbolul global al TLSH-ului nostru e redenumit, ca sa nu se bata cu cel din YARA", () => {
  const build = readNative(path.join("tlsh-sys", "build.rs"));
  assert.ok(
    build.includes('build.define("topval", "discord_patch_bot_tlsh_topval");'),
    "libyara isi vendorizeaza propria copie a TLSH, iar `topval` e singura variabila globala mutabila din " +
      "sursa: fara redenumire, linkerul de pe Linux respinge binarul cu `duplicate symbol`. Pe Windows " +
      "problema nu apare, deci disparitia liniei ar trece nevazuta local si ar pica abia in CI"
  );
});
