"use strict";

import fs from "fs";
import path from "path";

const root = process.cwd();
const repoRoot = path.resolve(root, "..");
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist", "target", "src"]);
const scannedExtensions = new Set<string>([
  ".ts", ".js", ".mjs", ".cjs", ".rs", ".md", ".json", ".yml", ".yaml", ".toml", ".sh"
]);

const MARKERS = ["<<<<<<< ", "=======", ">>>>>>> "];

function walk(dir: string, files: string[], skipSrc: boolean): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "src" && !skipSrc) continue;
    if (ignoredDirs.has(entry.name) && entry.name !== "src") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files, skipSrc);
      continue;
    }
    if (scannedExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
}

function conflictLines(content: string): number[] {
  const lines = content.split("\n");
  const hits: number[] = [];
  let sawStart = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("<<<<<<< ")) { sawStart = true; hits.push(index + 1); continue; }
    if (!sawStart) continue;
    if (line === "=======" || line.startsWith(">>>>>>> ")) hits.push(index + 1);
    if (line.startsWith(">>>>>>> ")) sawStart = false;
  }
  return hits;
}

function main(): void {
  const files: string[] = [];
  walk(root, files, true);
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(repoRoot, entry.name);
    if (entry.isDirectory()) walk(fullPath, files, false);
    else if (scannedExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }

  const offenders: string[] = [];
  for (const file of new Set(files)) {
    const hits = conflictLines(fs.readFileSync(file, "utf8"));
    if (hits.length > 0) offenders.push(`${path.relative(repoRoot, file)}:${hits.join(",")}`);
  }

  if (offenders.length > 0) {
    console.error(`Marcatori de conflict Git nerezolvati (${MARKERS.join(" / ")}):`);
    for (const offender of offenders) console.error(`  ${offender}`);
    console.error("Rezolva conflictul si sterge liniile marcator inainte de commit.");
    process.exit(1);
  }
  console.log(`check-no-conflict-markers: OK (${new Set(files).size} fisiere scanate, niciun marcator ramas)`);
}

main();
