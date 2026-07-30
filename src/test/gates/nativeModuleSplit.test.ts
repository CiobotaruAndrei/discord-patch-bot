import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const NATIVE_CORE = path.join(process.cwd(), "native", "core", "src");
const MODULE_LINE_CAP = 700;

function read(file: string): string {
  return fs.readFileSync(path.join(NATIVE_CORE, file), "utf8");
}

function codeBeforeTests(source: string): string {
  const marker = source.indexOf("#[cfg(test)]");
  return marker === -1 ? source : source.slice(0, marker);
}

function declares(source: string, item: string): boolean {
  return new RegExp(`^(?:pub(?:\\(crate\\))? )?${item}\\b`, "m").test(source);
}

const OWNERSHIP: ReadonlyArray<{ file: string; owns: readonly string[] }> = [
  { file: "magic_signatures.rs", owns: ["struct Signature", "fn detect_signature", "fn zip_flavor", "fn isobmff_flavor", "fn riff_flavor"] },
  { file: "magic_mime_table.rs", owns: ["fn mime_for_extension", "fn kind_for_mime", "fn mime_family", "fn compatible", "fn is_refinable_container"] },
  { file: "magic_encoding.rs", owns: ["fn detect_encoding", "fn looks_truncated"] },
  { file: "executable_types.rs", owns: ["struct ExecutableSection", "struct ExecutableReport", "enum ExecutableOutcome", "struct ExecutableLimits", "struct CodeRegion"] },
  { file: "executable_heuristics.rs", owns: ["fn shannon_entropy", "fn analysis_blind_spots", "fn looks_like_executable", "fn is_pe", "fn is_elf", "fn is_mach_o"] }
];

const ORCHESTRATION: ReadonlyArray<{ file: string; keeps: readonly string[] }> = [
  { file: "magic.rs", keeps: ["fn inspect_magic", "fn detect_type", "fn combine_verdicts", "fn libmagic_available"] },
  { file: "executable.rs", keeps: ["fn analyze_executable", "fn locate_code_region", "fn executable_analysis_available"] }
];

test("fiecare modul nativ nou detine responsabilitatea din numele lui", () => {
  for (const { file, owns } of OWNERSHIP) {
    const source = read(file);
    for (const item of owns) {
      assert.ok(declares(source, item), `${file} trebuie sa defineasca "${item}"`);
    }
  }
});

test("orchestrarea nu mai contine tabele de MIME, semnaturi sau euristici", () => {
  for (const { file, keeps } of ORCHESTRATION) {
    const orchestration = codeBeforeTests(read(file));
    for (const item of keeps) {
      assert.ok(declares(orchestration, item), `${file} pastreaza orchestrarea: "${item}"`);
    }
    for (const { file: owner, owns } of OWNERSHIP) {
      for (const item of owns) {
        assert.ok(!declares(orchestration, item), `"${item}" apartine lui ${owner}, nu lui ${file}`);
      }
    }
  }
});

test("niciun modul din crate-ul nativ nu depaseste plafonul de linii", () => {
  const offenders: string[] = [];
  for (const entry of fs.readdirSync(NATIVE_CORE, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".rs")) continue;
    const lines = read(entry.name).split("\n").length;
    if (lines > MODULE_LINE_CAP) offenders.push(`${entry.name} (${lines})`);
  }
  assert.deepEqual(
    offenders,
    [],
    `peste ${MODULE_LINE_CAP} linii un modul nativ amesteca prea multe responsabilitati: ${offenders.join(", ")}`
  );
});

test("modulele noi sunt declarate in lib.rs, iar contractul public arata proprietarul real", () => {
  const lib = read("lib.rs");
  for (const { file } of OWNERSHIP) {
    const moduleName = file.replace(/\.rs$/, "");
    assert.match(lib, new RegExp(`^mod ${moduleName};`, "m"), `lib.rs declara modulul ${moduleName}`);
  }
  assert.match(lib, /^pub use executable_types::\{CodeRegion, ExecutableLimits, ExecutableOutcome, ExecutableReport, ExecutableSection\};/m);
  assert.match(lib, /^pub use executable_heuristics::\{analysis_blind_spots, looks_like_executable, shannon_entropy\};/m);
  assert.match(lib, /^pub use executable::\{analyze_executable, executable_analysis_available, locate_code_region\};/m);
});
