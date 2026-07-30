import fs from "fs";
import path from "path";

const INSPECTION_MODULES: readonly string[] = [
  "inspection.rs",
  "inspection_archives.rs",
  "inspection_budgets.rs",
  "inspection_bytes.rs",
  "inspection_indicators.rs",
  "inspection_ole.rs",
  "inspection_pdf.rs",
  "inspection_verdict.rs"
];

const EXECUTABLE_MODULES: readonly string[] = [
  "executable.rs",
  "executable_heuristics.rs",
  "executable_types.rs"
];

const MAGIC_MODULES: readonly string[] = [
  "magic.rs",
  "magic_encoding.rs",
  "magic_mime_table.rs",
  "magic_signatures.rs"
];

export function inspectionSourceRoot(): string {
  return path.join(process.cwd(), "native", "core", "src");
}

export function readInspectionModule(file: string): string {
  return fs.readFileSync(path.join(inspectionSourceRoot(), file), "utf8");
}

function joinModules(files: readonly string[]): string {
  return files.map(file => readInspectionModule(file)).join("\n");
}

export function readInspectionSources(): string {
  return joinModules(INSPECTION_MODULES);
}

export function readExecutableSources(): string {
  return joinModules(EXECUTABLE_MODULES);
}

export function readMagicSources(): string {
  return joinModules(MAGIC_MODULES);
}

export { EXECUTABLE_MODULES, INSPECTION_MODULES, MAGIC_MODULES };
