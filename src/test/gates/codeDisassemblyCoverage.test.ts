import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();

function readNative(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, "native", "core", relative), "utf8");
}

test("motorul legat este Capstone, nu o reimplementare in Rust", () => {
  const manifest = readNative("Cargo.toml");
  assert.match(
    manifest,
    /^capstone = \{ version = "[^"]+", optional = true \}$/m,
    "punctul intregii etape e sa citim instructiunile cu motorul de referinta; un port aproximativ ar da alte rezultate pe exact cazurile grele"
  );
  assert.match(manifest, /^disassembly = \["dep:capstone"\]$/m, "capacitatea trebuie sa aiba feature propriu, ca restul librariilor native");
  assert.match(manifest, /^default = \[.*"disassembly".*\]$/m, "un feature care nu e in default nu ruleaza nicaieri si nu apara pe nimeni");
});

test("dezasamblarea ramane plafonata, fiindca octetii vin de la un expeditor necunoscut", () => {
  const modul = readNative(path.join("src", "code_disassembly.rs"));
  for (const plafon of ["max_instructions", "max_code_bytes", "max_indicators"]) {
    assert.ok(modul.includes(plafon), `fara ${plafon} un fisier construit anume poate tine analiza ocupata cat vrea`);
  }
});

test("instructiunile citite ajung efectiv in raport si in punctele oarbe", () => {
  const inspection = readNative(path.join("src", "inspection.rs"));
  assert.ok(
    /indicators\.extend\(disassembly_indicators\(bytes\)\)/.test(inspection),
    "un modul care nu e chemat din raport e cod mort care da impresia de acoperire"
  );
  assert.ok(
    inspection.includes("DISASSEMBLY_EXPLAINED_SPOTS"),
    "cand instructiunile explica un punct orb, punctul orb trebuie sa dispara, altfel raportam si necunoscuta si raspunsul ei"
  );
});

test("punctele oarbe pe care dezasamblarea le inchide exista cu exact acelasi text", () => {
  const inspection = readNative(path.join("src", "inspection.rs"));
  const executable = readNative(path.join("src", "executable.rs"));

  const bloc = inspection.match(/const DISASSEMBLY_EXPLAINED_SPOTS: \[&str; \d+\] =\s*\[([\s\S]*?)\];/);
  assert.ok(bloc, "lista de puncte oarbe explicate trebuie sa fie declarata explicit, ca sa poata fi verificata");

  const spots = [...bloc[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.ok(spots.length > 0, "o lista goala ar face filtrarea o operatie fara efect");

  for (const spot of spots) {
    assert.ok(
      executable.includes(`"${spot}"`),
      `punctul orb ${JSON.stringify(spot)} nu mai apare in executable.rs; filtrarea s-ar face pe un text care nu se mai produce, ` +
        "deci ar trece verde fara sa curete nimic — exact genul de nepotrivire tacuta care nu se vede la rulare"
    );
  }
});

test("Capstone este declarat in inventarul de librarii native", async () => {
  const { NATIVE_COMPONENTS } = await import("../../scripts/native-sbom.js");
  const declarate = NATIVE_COMPONENTS.filter(component => component.crate.startsWith("capstone"));
  assert.equal(declarate.length, 2, "si crate-ul, si legaturile lui FFI ajung in binarul livrat, deci amandoua apar in inventar");
  for (const component of declarate) {
    assert.match(component.vendored, /Capstone/, "inventarul trebuie sa spuna ce librarie C se livreaza efectiv, nu doar numele crate-ului");
  }
});
