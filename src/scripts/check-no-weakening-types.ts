"use strict";

const fs = require("fs");
const path = require("path");
const ts = require("typescript") as typeof import("typescript");

interface WeakeningViolation {
  line: number;
  kind: string;
  text: string;
}

const root = process.cwd();
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist", "target", "test"]);
const ignoredFiles = new Set<string>([
  path.normalize(path.join("native", "index.js")),
  path.normalize(path.join("native", "index.d.ts"))
]);
const checkedExtensions = new Set<string>([".ts", ".js"]);

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
    if (ignoredFiles.has(rel)) continue;
    files.push(fullPath);
  }
}

function run(): void {
  const files: string[] = [];
  walk(root, files);
  const violations: Array<{ file: string; line: number; kind: string; text: string }> = [];
  for (const file of files.sort()) {
    const rel = path.normalize(path.relative(root, file));
    const text = fs.readFileSync(file, "utf8");
    for (const v of findWeakeningTypes(text, file)) {
      violations.push({ file: rel, line: v.line, kind: v.kind, text: v.text });
    }
  }
  if (violations.length > 0) {
    console.error("Type-weakening constructs are not allowed in production code (rule 2): no `any`, `as never`, or `as unknown as`.");
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line}  [${v.kind}]  ${v.text}`);
    }
    console.error(`\nTotal: ${violations.length}. Model the real type, narrow via a structural contract (as Record<string, unknown> from unknown is fine), or move a deliberate-invalid case into a bug-catching test (src/test).`);
    process.exit(1);
  }
  console.log(`No-weakening-types OK: scanned ${files.length} production files, 0 any / as never / as unknown as`);
}

module.exports = { findWeakeningTypes };

if (require.main === module) run();

export {};
