import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import { renderCommandReferenceDoc, COMMAND_REFERENCE_DOC_RELATIVE_PATH } from "../features/command-catalog/commandReferenceDoc.js";

export interface CommandReferenceEvaluation {
  inSync: boolean;
  missing: boolean;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function evaluateCommandReferenceDoc(existing: string | null, rendered: string): CommandReferenceEvaluation {
  if (existing === null) return { inSync: false, missing: true };
  return { inSync: normalizeNewlines(existing) === normalizeNewlines(rendered), missing: false };
}

function writeCommandReferenceDocAtomic(fs: typeof import("fs"), path: typeof import("path"), target: string, rendered: string): void {
  const targetDir = path.dirname(target);
  const tempDir = fs.mkdtempSync(path.join(targetDir, ".command-reference-"));
  const tempTarget = path.join(tempDir, path.basename(target));
  try {
    fs.writeFileSync(tempTarget, rendered, "utf8");
    fs.renameSync(tempTarget, target);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function main(): void {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const repoRoot = path.resolve(process.cwd(), "..");
  const target = path.join(repoRoot, COMMAND_REFERENCE_DOC_RELATIVE_PATH);
  const rendered = renderCommandReferenceDoc();
  const checkMode = process.argv.includes("--check");

  if (checkMode) {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    const evaluation = evaluateCommandReferenceDoc(existing, rendered);
    if (evaluation.missing) {
      console.error(`::error::[check-docs-commands] ${COMMAND_REFERENCE_DOC_RELATIVE_PATH} lipseste. Ruleaza 'npm run docs:commands'.`);
      process.exit(1);
    }
    if (!evaluation.inSync) {
      console.error(
        `::error::[check-docs-commands] ${COMMAND_REFERENCE_DOC_RELATIVE_PATH} a divergat de catalogul de comenzi. ` +
        "Ruleaza 'npm run docs:commands' si comite fisierul regenerat."
      );
      process.exit(1);
    }
    console.log(`check-docs-commands OK: ${COMMAND_REFERENCE_DOC_RELATIVE_PATH} este sincronizat cu COMMAND_CATALOG_HELP.`);
    return;
  }

  writeCommandReferenceDocAtomic(fs, path, target, rendered);
  console.log(`${COMMAND_REFERENCE_DOC_RELATIVE_PATH} regenerat din COMMAND_CATALOG_HELP.`);
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

export {};
