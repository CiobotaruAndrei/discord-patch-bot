import test from "node:test";
import assert from "node:assert/strict";
import { readInspectionModule } from "./nativeInspectionSources.js";

function codeBeforeTests(source: string): string {
  const marker = source.indexOf("#[cfg(test)]");
  return marker === -1 ? source : source.slice(0, marker);
}

const OWNERSHIP: ReadonlyArray<{ file: string; owns: readonly string[] }> = [
  { file: "inspection_budgets.rs", owns: ["struct InspectionLimits", "struct Budget", "fn enforce_budget", "const CFB_MAX_FAT_SECTORS", "const PDF_MAX_STREAMS", "const TEXT_LINK_SCAN_BYTES"] },
  { file: "inspection_verdict.rs", owns: ["struct InspectionReport", "struct Finding", "fn uncertain", "fn inspected", "fn dedupe"] },
  { file: "inspection_bytes.rs", owns: ["fn find", "fn contains_word", "fn read_u32_le", "fn xml_attribute", "fn window_contains"] },
  { file: "inspection_pdf.rs", owns: ["fn is_pdf", "fn has_obfuscated_pdf_action_name", "fn pdf_structural_indicators", "fn pdf_image_indicators", "fn pdf_deep_indicators"] },
  { file: "inspection_ole.rs", owns: ["fn is_compound_file_binary", "fn inspect_compound_file_binary", "fn decode_msi_stream_name", "fn msi_indicators", "fn chm_indicators", "fn ooxml_relationship_indicators"] },
  { file: "inspection_archives.rs", owns: ["fn inspect_zip", "fn inspect_tar", "fn inspect_gzip", "fn scan_rar4_headers", "fn scan_rar5_headers", "fn scan_seven_zip_headers", "fn header_scan_finding", "fn inspect_native_container"] },
  { file: "inspection_indicators.rs", owns: ["fn name_indicators", "fn content_indicators", "fn document_indicators", "fn executable_indicators", "fn visual_indicators", "fn text_link_indicators"] }
];

const ORCHESTRATION_ONLY: readonly string[] = [
  "fn inspect_untrusted_content",
  "fn inspect_nested",
  "fn container_signature",
  "fn looks_like_archive",
  "fn document_finding",
  "fn uninspectable_format"
];

function declares(source: string, item: string): boolean {
  return new RegExp(`^(?:pub(?:\\(crate\\))? )?${item}\\b`, "m").test(source);
}

test("fiecare modul de inspectie detine exact responsabilitatea din numele lui", () => {
  for (const { file, owns } of OWNERSHIP) {
    const source = readInspectionModule(file);
    for (const item of owns) {
      assert.ok(declares(source, item), `${file} trebuie sa defineasca "${item}"`);
    }
  }
});

test("inspection.rs a ramas doar orchestrare: nu mai contine parsere de format, bugete sau constructori de verdict", () => {
  const orchestration = codeBeforeTests(readInspectionModule("inspection.rs"));
  for (const { file, owns } of OWNERSHIP) {
    for (const item of owns) {
      assert.ok(!declares(orchestration, item), `"${item}" apartine lui ${file}, nu lui inspection.rs`);
    }
  }
  for (const item of ORCHESTRATION_ONLY) {
    assert.ok(declares(orchestration, item), `inspection.rs pastreaza orchestrarea: "${item}"`);
  }
});

test("niciun modul de inspectie nu redevine un fisier monolit", () => {
  const orchestrationLines = codeBeforeTests(readInspectionModule("inspection.rs")).split("\n").length;
  assert.ok(
    orchestrationLines <= 320,
    `orchestrarea din inspection.rs are ${orchestrationLines} linii de cod; peste 320 inseamna ca logica de format s-a intors inapoi`
  );
  for (const file of ["inspection.rs", ...OWNERSHIP.map(entry => entry.file)]) {
    const lines = readInspectionModule(file).split("\n").length;
    assert.ok(lines <= 700, `${file} are ${lines} linii; peste 700 inseamna ca modulul trebuie despartit mai departe`);
  }
});

test("modulele de inspectie sunt declarate in lib.rs si contractul public nu mai trece prin inspection.rs", () => {
  const lib = readInspectionModule("lib.rs");
  for (const { file } of OWNERSHIP) {
    const moduleName = file.replace(/\.rs$/, "");
    assert.match(lib, new RegExp(`^mod ${moduleName};`, "m"), `lib.rs declara modulul ${moduleName}`);
  }
  assert.match(lib, /^pub use inspection_budgets::InspectionLimits;/m);
  assert.match(lib, /^pub use inspection_verdict::InspectionReport;/m);
  assert.match(lib, /^pub use inspection_pdf::has_obfuscated_pdf_action_name;/m);
  assert.match(lib, /^pub use inspection_ole::\{decode_msi_stream_name, inspect_compound_file_binary\};/m);
  assert.match(lib, /^pub use inspection_indicators::document_indicators;/m);
});
