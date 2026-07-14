import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const featuresRoot = path.join(srcRoot, "features");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const REQUIRE_CALL = /\brequire\s*\(/;
const CREATE_REQUIRE = /createRequire/;

test("granita ESM: niciun modul din src/features nu mai foloseste require sau createRequire (review 16-iteme #14)", () => {
  const offenders: string[] = [];
  for (const file of collectTsFiles(featuresRoot)) {
    const text = fs.readFileSync(file, "utf8");
    if (REQUIRE_CALL.test(text) || CREATE_REQUIRE.test(text)) {
      offenders.push(path.relative(srcRoot, file).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(offenders, [], `modulele de feature trebuie sa foloseasca doar import ESM static, nu require/createRequire: ${offenders.join(", ")}`);
});

test("granita ESM: modulele de feature convertite nu mai poarta shim-ul createRequire in capul fisierului", () => {
  const converted = [
    "features/notifications/index.ts",
    "features/notifications/outboxRuntimeFactory.ts",
    "features/command-handlers/snoozeInteractionHandler.ts",
    "features/command-security/commandSnoozeGuard.ts",
    "features/command-handlers/helpInteractionHandler.ts",
    "features/command-handlers/reportViews.ts",
    "features/command-handlers/reportInteractionHandler.ts",
    "features/command-security/globalAccessCodeModal.ts",
    "features/command-security/adminScopeIds.ts",
    "features/command-handlers/adminCommandAccessHandler.ts"
  ];
  for (const relative of converted) {
    const text = fs.readFileSync(path.join(srcRoot, relative), "utf8");
    assert.ok(!text.includes("createRequire"), `${relative} inca importa createRequire`);
    assert.ok(!/} = require\(/.test(text) && !/= require\(/.test(text), `${relative} inca destructureaza dintr-un require`);
  }
});
