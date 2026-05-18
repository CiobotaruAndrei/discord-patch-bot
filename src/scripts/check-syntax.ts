// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const ignoredDirs = new Set<string>([".git", "node_modules", "coverage", "dist"]);
const files: string[] = [];

function walk(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
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
