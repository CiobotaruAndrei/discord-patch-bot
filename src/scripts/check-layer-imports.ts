"use strict";

import fs from "node:fs";
import path from "node:path";

const root = path.resolve("features");
const violations: string[] = [];
function walk(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith(".ts")) {
      const text = fs.readFileSync(file, "utf8");
      if (text.includes("app/runtimeComposition")) violations.push(file);
    }
  }
}
walk(root);
if (violations.length) throw new Error(`Importuri interzise features -> app/runtimeComposition: ${violations.join(", ")}`);
process.stdout.write("Layer imports OK\n");
