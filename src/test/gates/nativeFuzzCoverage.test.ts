import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const nativeRoot = path.join(srcRoot, "native");
const sanitizerWorkflowPath = path.join(repoRoot, ".github", "workflows", "native-sanitizers.yml");

function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function discoverFuzzTargets(): { crate: string; target: string; file: string }[] {
  const targets: { crate: string; target: string; file: string }[] = [];
  for (const crate of fs.readdirSync(nativeRoot, { withFileTypes: true })) {
    if (!crate.isDirectory()) continue;
    const testsDir = path.join(nativeRoot, crate.name, "tests");
    if (!fs.existsSync(testsDir)) continue;
    for (const entry of fs.readdirSync(testsDir)) {
      if (!entry.endsWith("_fuzz.rs")) continue;
      targets.push({ crate: crate.name, target: entry.replace(/\.rs$/, ""), file: path.join(testsDir, entry) });
    }
  }
  return targets;
}

test("exista tinte de fuzz atat pentru parserele native cat si pentru protocolul inspectorului", () => {
  const targets = discoverFuzzTargets().map(entry => entry.target);
  assert.ok(targets.includes("parser_fuzz"), "wrapper-ele peste libyara/libarchive/qpdf au nevoie de intrare ostila");
  assert.ok(targets.includes("protocol_fuzz"), "cadrele primite de la procesul izolat sunt intrare netrusted");
});

test("fiecare tinta de fuzz descoperita e rulata si sub sanitizer, nu doar in check", () => {
  const workflow = readText(sanitizerWorkflowPath);
  for (const { crate, target } of discoverFuzzTargets()) {
    assert.match(
      workflow,
      new RegExp(`--test ${target}\\b`),
      `${crate}/tests/${target}.rs nu apare in native-sanitizers.yml: o tinta de fuzz fara sanitizer prinde panici, dar rateaza exact erorile de memorie din C/C++`
    );
  }
});

test("sanitizerul ruleaza noaptea si la cerere, nu ca gate de PR", () => {
  const workflow = readText(sanitizerWorkflowPath);
  assert.match(workflow, /workflow_dispatch:/, "trebuie sa poata fi pornit manual");
  assert.match(workflow, /schedule:/, "trebuie sa ruleze programat");
  assert.doesNotMatch(
    workflow,
    /^on:[\s\S]*?^\s{2}pull_request:/m,
    "recompilarea intregului strat C/C++ cu instrumentare depaseste bugetul de timp al unui PR"
  );
});

test("sanitizerul cere toolchain nightly si build-std, altfel instrumentarea nu acopera libraria standard", () => {
  const workflow = readText(sanitizerWorkflowPath);
  assert.match(workflow, /toolchain: nightly/, "-Zsanitizer cere nightly");
  assert.match(workflow, /-Zbuild-std/, "fara build-std, std ramane neinstrumentat si apar fals-pozitive");
  assert.match(workflow, /-Zsanitizer=address/, "AddressSanitizer e cel care vede heap-ul librariilor C/C++");
});

test("tintele de fuzz raman in rularea implicita de cargo test din check:native", () => {
  const scripts = JSON.parse(readText(path.join(srcRoot, "package.json"))) as { scripts: Record<string, string> };
  const checkNative = scripts.scripts["check:native"];
  assert.ok(checkNative !== undefined, "check:native exista");
  const crates = new Set(discoverFuzzTargets().map(entry => entry.crate));
  const packageForCrate: Record<string, string> = { core: "discord_patch_bot_logic", inspector: "native-inspector" };
  for (const crate of crates) {
    const pkg = packageForCrate[crate];
    assert.ok(pkg !== undefined, `crate-ul ${crate} are tinte de fuzz dar nu e mapat la un pachet cargo`);
    assert.ok(
      checkNative.includes(`-p ${pkg}`),
      `${pkg} are tinte de fuzz dar check:native nu il ruleaza, deci fuzz-ul nu ar fi executat la niciun PR`
    );
  }
  assert.ok(checkNative.includes("--all-targets"), "clippy trebuie sa vada si tintele de test, nu doar libraria");
});

test("fiecare tinta de fuzz foloseste un generator determinist, ca esecul sa fie reproductibil", () => {
  for (const { target, file } of discoverFuzzTargets()) {
    const source = readText(file);
    assert.match(source, /struct Xorshift\(u64\);/, `${target} isi genereaza singur octetii, fara sursa de entropie externa`);
    assert.doesNotMatch(
      source,
      /SystemTime|thread_rng|from_entropy/,
      `${target} nu are voie sa foloseasca o samanta variabila: un esec care nu se reproduce nu se poate repara`
    );
  }
});
