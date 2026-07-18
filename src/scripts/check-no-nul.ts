import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", "target"]);
const extensions = new Set([".ts", ".js", ".json", ".md", ".rs"]);

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(full);
  }
}

export function findNulBytes(files: readonly string[]): string[] {
  return files.filter(file => fs.readFileSync(file).includes(0)).map(file => path.relative(root, file));
}

export function run(): void {
  const files: string[] = [];
  walk(root, files);
  const violations = findNulBytes(files);
  if (violations.length) {
    console.error(`NUL bytes found in tracked text files:\n${violations.map(file => `- ${file}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`No-NUL OK: scanned ${files.length} text files`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) run();
