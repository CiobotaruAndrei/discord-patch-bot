import { pathToFileURL as __pathToFileURL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
"use strict";

export type Layer = "app" | "features" | "domain" | "infra" | "sources" | "shared";

export interface ModuleImport {
  from: string;
  to: string;
  typeOnly: boolean;
}

export interface LayerViolation {
  rule: string;
  from: string;
  to: string;
}

export interface LayerReport {
  violations: LayerViolation[];
  cycles: string[][];
  moduleCount: number;
  pass: boolean;
}

const RUNTIME_LAYERS: readonly Layer[] = ["app", "features", "domain", "infra", "sources", "shared"];

const FORBIDDEN_LAYER_EDGES: ReadonlyArray<{ from: Layer; to: Layer; rule: string; allowlist: readonly string[] }> = [
  {
    from: "infra", to: "app",
    rule: "infra nu depinde de app (compositia se face in bootstrap, nu invers)",
    allowlist: []
  },
  {
    from: "sources", to: "app",
    rule: "sources nu depinde de composition root (review nou, Major #8)",
    allowlist: []
  },
  { from: "domain", to: "app", rule: "domain e pur: fara dependinte spre app", allowlist: [] },
  { from: "domain", to: "features", rule: "domain e pur: fara dependinte spre features", allowlist: [] },
  { from: "domain", to: "infra", rule: "domain e pur: fara dependinte spre infra", allowlist: [] },
  { from: "domain", to: "sources", rule: "domain e pur: fara dependinte spre sources", allowlist: [] },
  { from: "shared", to: "app", rule: "shared e frunza: fara dependinte spre app", allowlist: [] },
  { from: "shared", to: "features", rule: "shared e frunza: fara dependinte spre features", allowlist: [] },
  { from: "shared", to: "infra", rule: "shared e frunza: fara dependinte spre infra", allowlist: [] },
  { from: "shared", to: "sources", rule: "shared e frunza: fara dependinte spre sources", allowlist: [] },
  { from: "shared", to: "domain", rule: "shared e frunza: fara dependinte spre domain", allowlist: [] }
];

const MONGO_VALUE_IMPORT_ALLOWLIST: readonly string[] = [
  "features/command-runtime/commandRuntimeDependencies.ts",
  "features/admin-records/operationJournalRuntime.ts"
];

const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?["'](\.[^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["'](\.[^"']+)["']\s*\)/g;

export function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

export function layerOf(modulePath: string): Layer | null {
  const first = modulePath.split("/")[0];
  return (RUNTIME_LAYERS as readonly string[]).includes(first) ? (first as Layer) : null;
}

export function resolveRelativeImport(fromModule: string, specifier: string): string | null {
  const withTs = specifier.endsWith(".js") ? `${specifier.slice(0, -3)}.ts` : specifier;
  const resolved = toPosix(path.normalize(path.join(path.dirname(fromModule), withTs)));
  return resolved.endsWith(".ts") ? resolved : null;
}

export function extractImports(modulePath: string, source: string): ModuleImport[] {
  const imports: ModuleImport[] = [];
  const seen = new Set<string>();
  const push = (specifier: string, typeOnly: boolean): void => {
    const target = resolveRelativeImport(modulePath, specifier);
    if (!target) return;
    const key = `${target}|${typeOnly}`;
    if (seen.has(key)) return;
    seen.add(key);
    imports.push({ from: modulePath, to: target, typeOnly });
  };
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    push(match[3], Boolean(match[2]));
  }
  while ((match = DYNAMIC_IMPORT_RE.exec(source)) !== null) {
    push(match[1], false);
  }
  return imports;
}

function collectModuleFiles(root: string): string[] {
  const files: string[] = [];
  for (const layer of RUNTIME_LAYERS) {
    const layerDir = path.join(root, layer);
    if (!fs.existsSync(layerDir)) continue;
    const stack = [layerDir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          files.push(toPosix(path.relative(root, full)));
        }
      }
    }
  }
  return files.sort();
}

export function findLayerViolations(imports: readonly ModuleImport[]): LayerViolation[] {
  const violations: LayerViolation[] = [];
  for (const moduleImport of imports) {
    const fromLayer = layerOf(moduleImport.from);
    const toLayer = layerOf(moduleImport.to);
    if (!fromLayer || !toLayer) continue;
    for (const edge of FORBIDDEN_LAYER_EDGES) {
      if (fromLayer !== edge.from || toLayer !== edge.to) continue;
      if (edge.allowlist.includes(moduleImport.from)) continue;
      violations.push({ rule: edge.rule, from: moduleImport.from, to: moduleImport.to });
    }
    if (
      fromLayer === "features"
      && !moduleImport.typeOnly
      && moduleImport.to.startsWith("infra/mongo/")
      && !MONGO_VALUE_IMPORT_ALLOWLIST.includes(moduleImport.from)
    ) {
      violations.push({
        rule: "features acceseaza Mongo doar prin repositories/DI, nu prin importuri de valori din infra/mongo (importurile de tip raman permise)",
        from: moduleImport.from,
        to: moduleImport.to
      });
    }
  }
  return violations;
}

export function findImportCycles(imports: readonly ModuleImport[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const moduleImport of imports) {
    if (moduleImport.typeOnly) continue;
    const targets = graph.get(moduleImport.from) ?? [];
    targets.push(moduleImport.to);
    graph.set(moduleImport.from, targets);
  }
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (node: string): void => {
    const nodeState = state.get(node);
    if (nodeState === "done") return;
    if (nodeState === "visiting") {
      const start = stack.indexOf(node);
      if (start >= 0) {
        const cycle = stack.slice(start);
        const key = [...cycle].sort().join("->");
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push([...cycle, node]);
        }
      }
      return;
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop();
    state.set(node, "done");
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}

export function buildLayerReport(root: string): LayerReport {
  const files = collectModuleFiles(root);
  const imports: ModuleImport[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    imports.push(...extractImports(file, source));
  }
  const violations = findLayerViolations(imports);
  const cycles = findImportCycles(imports);
  return { violations, cycles, moduleCount: files.length, pass: violations.length === 0 && cycles.length === 0 };
}

function main(): void {
  const report = buildLayerReport(process.cwd());
  for (const violation of report.violations) {
    console.error(`::error::[check-layer-imports] ${violation.from} -> ${violation.to}: ${violation.rule}`);
  }
  for (const cycle of report.cycles) {
    console.error(`::error::[check-layer-imports] ciclu de importuri runtime: ${cycle.join(" -> ")}`);
  }
  if (!report.pass) {
    console.error(`check-layer-imports: ${report.violations.length} incalcari de strat si ${report.cycles.length} cicluri pe ${report.moduleCount} module.`);
    process.exit(1);
  }
  console.log(`check-layer-imports OK: ${report.moduleCount} module respecta regulile de dependinte intre straturi (fara infra->app, sources->app, domain/shared impure, valori Mongo in features sau cicluri runtime).`);
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
