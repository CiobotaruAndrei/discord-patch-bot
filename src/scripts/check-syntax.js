// @ts-check
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
/** @type {Set<string>} */
const ignoredDirs = new Set([".git", "node_modules", "coverage", "dist"]);
/** @type {string[]} */
const files = [];

/**
 * @param {string} dir
 */
function walk(dir) {
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

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failed = true;
    const rel = path.relative(root, file);
    console.error(`Syntax check failed: ${rel}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
  }
}

if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files`);
