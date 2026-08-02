"use strict";

import fs from "fs";
import path from "path";

const root = process.cwd();
const skipped = new Set<string>(["node_modules", "dist", "coverage", "target", ".git"]);
const scanned = new Set<string>([".ts", ".js", ".mjs", ".cjs"]);

const RETIRED = [
  "bot-add-request",
  "bot-add-permissions",
  "bot-add-alert-channel",
  "bot-add-protection",
  "botAddAlertChannelId",
  "botAddProtectionEnabled",
  "botAddPermissions"
];

const ALLOWED = new Set<string>([
  path.join("infra", "mongo", "migrations", "m18_unifyPermissionRequests.ts"),
  path.join("infra", "mongo", "migrations", "m19_dropLegacyBotAddFields.ts"),
  path.join("scripts", "check-no-retired-bot-add.ts"),
  path.join("test", "security", "botAddUnderModerationGuard.test.ts")
]);

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (scanned.has(path.extname(entry.name))) files.push(fullPath);
  }
}

function main(): void {
  const files: string[] = [];
  walk(root, files);

  const offenders: string[] = [];
  for (const file of files) {
    const relative = path.relative(root, file);
    if (ALLOWED.has(relative)) continue;
    const content = fs.readFileSync(file, "utf8");
    const found = RETIRED.filter(name => content.includes(name));
    if (found.length > 0) offenders.push(`${relative}: ${found.join(", ")}`);
  }

  if (offenders.length > 0) {
    console.error("Nume retrase din protectia bot-add au reaparut in cod:");
    for (const offender of offenders) console.error(`  ${offender}`);
    console.error("Aprobarea adaugarii de boti traieste in /permission-request si moderation-guard, nu in comenzi si campuri separate.");
    process.exit(1);
  }
  console.log(`check-no-retired-bot-add: OK (${files.length} fisiere scanate, nicio ramasita)`);
}

main();
