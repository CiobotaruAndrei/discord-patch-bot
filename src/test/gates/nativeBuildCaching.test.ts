import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import { nativeCheckCommands, parseHostTriple } from "../../scripts/check-native.js";
import { inspectorArtifactName, inspectorArtifactPaths, inspectorBuildArgs } from "../../scripts/build-native-inspector.js";

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

test("check:native trece prin scriptul care aliniaza tripletul cu napi", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    scripts.scripts["check:native"],
    "node scripts/check-native.ts",
    "cargo fara --target scrie in target/release, iar napi build in target/<triplet>/release; " +
      "cele patru librarii C/C++ s-ar compila de doua ori per rulare, in CI, pe Windows si la release"
  );
});

test("comenzile native poarta tripletul, si clippy si test", () => {
  for (const args of nativeCheckCommands("x86_64-unknown-linux-gnu")) {
    const targetAt = args.indexOf("--target");
    assert.notEqual(targetAt, -1, `lipseste --target din ${args[0]}`);
    assert.equal(args[targetAt + 1], "x86_64-unknown-linux-gnu");
  }
});

test("tripletul gazda e citit din iesirea reala a lui rustc -vV", () => {
  const sample = "rustc 1.96.0 (abcdef 2026-01-01)\nbinary: rustc\nhost: x86_64-pc-windows-msvc\nrelease: 1.96.0\n";
  assert.equal(parseHostTriple(sample), "x86_64-pc-windows-msvc");
  assert.equal(parseHostTriple("rustc 1.96.0\nrelease: 1.96.0\n"), undefined);
});

test("jobul de CI nu mai are nevoie de variabila per-workflow", () => {
  assert.equal(
    ciWorkflow.includes("CARGO_BUILD_TARGET"),
    false,
    "alinierea se face acum in check:native, deci merge si pe Windows, si la release, si local; " +
      "o variabila repetata per workflow s-ar uita la al patrulea"
  );
});

test("binarul de inspectie se compileaza cu acelasi triplet si ajunge in imaginea de runtime", () => {
  assert.match(
    dockerfile,
    /RUN npm run build:inspector:prebuilt/,
    "`napi build` compileaza doar addon-ul cdylib, deci binarul de inspectie cere un pas separat; " +
      "fara el, productia Linux ar cadea mereu inapoi pe addon-ul in-proces"
  );
  assert.match(
    dockerfile,
    /COPY --from=build \/app\/src\/native\/native-inspector \.\/native\//,
    "binarul compilat in stratul de build nu exista in imaginea finala daca nu e copiat explicit"
  );
  const target = "x86_64-unknown-linux-gnu";
  const args = inspectorBuildArgs(target);
  const targetAt = args.indexOf("--target");
  assert.notEqual(targetAt, -1, "fara --target, cargo scrie in target/release si recompila librariile C/C++ de la zero");
  assert.equal(args[targetAt + 1], target);
  assert.deepEqual(
    inspectorArtifactPaths(target, "linux"),
    { built: path.join("native", "target", target, "release", "native-inspector"), installed: path.join("native", "native-inspector") },
    "binarul se instaleaza langa addon, acolo unde il cauta rutarea implicita"
  );
  assert.equal(inspectorArtifactName("win32"), "native-inspector.exe");
});
