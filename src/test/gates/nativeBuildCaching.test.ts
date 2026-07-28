import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const repoRoot = path.resolve(process.cwd(), "..");
const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
const ciWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

function indexOfOrFail(haystack: string, needle: string | RegExp, label: string): number {
  const index = typeof needle === "string" ? haystack.indexOf(needle) : haystack.search(needle);
  assert.notEqual(index, -1, `nu am gasit ${label} in fisier`);
  return index;
}

test("dependintele cargo se pre-compileaza inainte de stratul npm", () => {
  const cargoPrebuild = indexOfOrFail(dockerfile, /cargo build --release --target/, "pre-compilarea dependintelor cargo");
  const npmCi = indexOfOrFail(dockerfile, "RUN npm ci", "stratul npm ci");
  assert.ok(
    cargoPrebuild < npmCi,
    "librariile C/C++ se compileaza in stratul de dependinte cargo; daca acela vine dupa `npm ci`, " +
      "orice bump de dependinta npm il invalideaza si le recompileaza degeaba (masurat: 85s vs 290-340s)"
  );
});

test("pre-compilarea copiaza doar manifestele, nu tot arborele native", () => {
  const manifestCopy = indexOfOrFail(dockerfile, "COPY src/native/Cargo.toml", "copierea manifestelor cargo");
  const fullNativeCopy = indexOfOrFail(dockerfile, "COPY src/native/ ./native/", "copierea completa a lui native/");
  assert.ok(
    manifestCopy < fullNativeCopy,
    "daca stratul de dependinte ar copia tot native/, orice editare de .rs l-ar invalida si pre-compilarea n-ar mai avea rost"
  );
});

test("pre-compilarea foloseste tripletul gazda, acelasi pe care il foloseste napi", () => {
  assert.match(
    dockerfile,
    /rustc -vV \| sed -n 's\/\^host: \/\/p'/,
    "napi build compileaza cu --target, deci scrie in target/<triplet>/release; un cargo build fara --target " +
      "ar popula target/release, iar pre-compilarea n-ar fi refolosita de nimeni"
  );
  assert.match(dockerfile, /cargo clean --release --target "\$TARGET"/);
});

test("jobul de CI aliniaza tripletul, ca librariile C/C++ sa nu se compileze de doua ori", () => {
  assert.match(
    ciWorkflow,
    /CARGO_BUILD_TARGET: x86_64-unknown-linux-gnu/,
    "fara asta, clippy si cargo test scriu in target/release, iar napi build in target/<triplet>/release, " +
      "deci libyara, libarchive, qpdf si ZXing-C++ se compileaza de doua ori per rulare"
  );
});
