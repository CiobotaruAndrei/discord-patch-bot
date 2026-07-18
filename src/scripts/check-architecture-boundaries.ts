"use strict";

import fs from "node:fs";
import path from "node:path";

export type ArchitectureViolation = { file: string; rule: string };

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "coverage", "target"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && full.endsWith(".ts")) files.push(full);
  }
}

export function collectArchitectureViolations(root = path.resolve(".")): ArchitectureViolation[] {
  const files: string[] = [];
  walk(root, files);
  const violations: ArchitectureViolation[] = [];
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const source = fs.readFileSync(file, "utf8");
    if (relative.startsWith("features/") && source.includes("app/runtimeComposition")) violations.push({ file: relative, rule: "features cannot import app/runtimeComposition" });
    if (relative.startsWith("features/") && /from ["'][^"']*infra\/mongo\/models(?:\.js)?["']/.test(source)) violations.push({ file: relative, rule: "features must depend on ports, not Mongo composition models" });
    if (relative.startsWith("features/command-handlers/") && source.includes("new mongoose.Schema")) violations.push({ file: relative, rule: "handlers cannot define persistence schemas" });
  }
  return violations;
}

export function run(): void {
  const violations = collectArchitectureViolations();
  if (violations.length) {
    for (const violation of violations) console.error(`- ${violation.file}: ${violation.rule}`);
    throw new Error(`Architecture boundaries failed (${violations.length} violation(s))`);
  }
  console.log("Architecture boundaries OK");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) run();
