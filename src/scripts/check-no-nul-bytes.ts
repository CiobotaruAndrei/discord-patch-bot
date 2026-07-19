"use strict";

import fs from "fs";
import path from "path";

const root = process.cwd();
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist", "target"]);
const textExtensions = new Set<string>([
  ".ts", ".js", ".mjs", ".cjs", ".rs", ".md", ".json", ".yml", ".yaml", ".txt", ".toml", ".sh", ".env"
]);

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (textExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
}

function main(): void {
  const files: string[] = [];
  walk(root, files);
  const offenders: string[] = [];
  for (const file of files) {
    if (fs.readFileSync(file).includes(0x00)) offenders.push(path.relative(root, file));
  }
  if (offenders.length > 0) {
    console.error("Fisiere text cu bytes NUL (0x00) literal - folositi secventa escapata `\\u0000`, nu byte-ul brut:");
    for (const file of offenders) console.error(`  ${file}`);
    process.exit(1);
  }
  console.log(`check-no-nul-bytes: OK (${files.length} fisiere text scanate, niciun byte NUL literal)`);
}

main();
