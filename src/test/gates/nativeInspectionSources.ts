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

export function inspectionSourceRoot(): string {
  return path.join(process.cwd(), "native", "core", "src");
}

export function readInspectionModule(file: string): string {
  return fs.readFileSync(path.join(inspectionSourceRoot(), file), "utf8");
}

export function readInspectionSources(): string {
  return INSPECTION_MODULES.map(file => readInspectionModule(file)).join("\n");
}

export { INSPECTION_MODULES };
