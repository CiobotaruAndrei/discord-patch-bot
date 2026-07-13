
"use strict";

import fs from "fs";
import path from "path";

const root = process.cwd();
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist", "target"]);
const ignoredGeneratedFiles = new Set<string>([
  path.normalize(path.join("native", "index.js"))
]);
const files: string[] = [];

function walk(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const rel = path.normalize(path.relative(root, fullPath));
      if (!ignoredGeneratedFiles.has(rel)) files.push(fullPath);
    }
  }
}

walk(root);

if (files.length > 0) {
  console.error("JavaScript source files are not allowed after the TypeScript migration:");
  for (const file of files.sort()) {
    console.error(`- ${path.relative(root, file)}`);
  }
  process.exit(1);
}

console.log("Syntax OK: 0 JavaScript source files");

export {};
