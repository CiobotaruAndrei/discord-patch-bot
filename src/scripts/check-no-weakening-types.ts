import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import fs from "fs";
import path from "path";
import ts from "typescript";

interface WeakeningViolation {
  line: number;
  kind: string;
  text: string;
}

const root = path.resolve(__dirname, "..", "..");
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist", "target"]);
const ignoredFiles = new Set<string>([
  path.normalize(path.join("native", "index.js")),
  path.normalize(path.join("native", "index.d.ts"))
]);
const bugCatchingTestFiles = new Set<string>([
  path.normalize(path.join("test", "gates", "checkNoWeakeningTypes.test.ts"))
]);
const checkedExtensions = new Set<string>([".ts", ".js"]);

function relativeMatches(rel: string, candidates: Set<string>): boolean {
  const norm = path.normalize(rel);
  if (candidates.has(norm)) return true;
  const segments = norm.split(path.sep);
  for (let i = 1; i < segments.length; i++) {
    if (candidates.has(segments.slice(i).join(path.sep))) return true;
  }
  return false;
}

function isBugCatchingRel(rel: string): boolean {
  return relativeMatches(rel, bugCatchingTestFiles);
}

function findWeakeningTypes(text: string, fileName = "file.ts"): WeakeningViolation[] {
  const scriptKind = fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const out: WeakeningViolation[] = [];
  function add(node: import("typescript").Node, kind: string): void {
    const lc = source.getLineAndCharacterOfPosition(node.getStart(source));
    out.push({ line: lc.line + 1, kind, text: node.getText(source).replace(/\s+/g, " ").slice(0, 80) });
  }
  function visit(node: import("typescript").Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      add(node, "any");
    } else if (ts.isAsExpression(node)) {
      if (node.type.kind === ts.SyntaxKind.NeverKeyword) {
        add(node, "as never");
      } else if (ts.isAsExpression(node.expression) && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword) {
        add(node, "as unknown as");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  out.sort((a, b) => a.line - b.line);
  return out;
}

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(fullPath, files); continue; }
    if (!entry.isFile()) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    const rel = path.normalize(path.relative(root, fullPath));
    if (relativeMatches(rel, ignoredFiles)) continue;
    files.push(fullPath);
  }
}

function canUseWeakeningTypes(file: string): boolean {
  return isBugCatchingRel(path.relative(root, file));
}

function collectWeakeningViolations(files: string[]): Array<{ file: string; line: number; kind: string; text: string }> {
  const violations: Array<{ file: string; line: number; kind: string; text: string }> = [];
  for (const file of files.sort()) {
    if (canUseWeakeningTypes(file)) continue;
    const rel = path.normalize(path.relative(root, file));
    const text = fs.readFileSync(file, "utf8");
    for (const v of findWeakeningTypes(text, file)) {
      violations.push({ file: rel, line: v.line, kind: v.kind, text: v.text });
    }
  }
  return violations;
}

function run(): void {
  const files: string[] = [];
  walk(root, files);
  const violations = collectWeakeningViolations(files);
  if (violations.length > 0) {
    console.error("Type-weakening constructs are not allowed in source code (rule 2): no `any`, `as never`, or `as unknown as`.");
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line}  [${v.kind}]  ${v.text}`);
    }
    console.error(`\nTotal: ${violations.length}. Model the real type, narrow via a structural contract (as Record<string, unknown> from unknown is fine), or add the deliberate-invalid case only to the explicit bug-catching test allowlist.`);
    process.exit(1);
  }
  console.log(`No-weakening-types OK: scanned ${files.length} source files, 0 any / as never / as unknown as outside explicit bug-catching tests`);
}

export { findWeakeningTypes, collectWeakeningViolations, canUseWeakeningTypes, isBugCatchingRel };

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) run();

export {};
