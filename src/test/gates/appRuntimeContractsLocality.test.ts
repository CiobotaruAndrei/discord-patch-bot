import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
import fs from "node:fs";
import path from "node:path";

const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
const appRoot = path.join(__dirname, "..", "..", "..", "app");
const read = (rel: string): string => fs.readFileSync(path.join(appRoot, rel), "utf8");

test("contractele AppRuntime traiesc in appRuntimeContracts.ts, nu in composition root (review 22 #10)", () => {
  const contracts = read("appRuntimeContracts.ts");
  for (const name of ["AppRuntimeDeps", "RuntimeServices", "Schedulers", "DiscordClientLike", "HttpServerLike", "AppRuntime", "CommandRuntime", "ScraperRuntime", "MongoContextLike"]) {
    assert.match(contracts, new RegExp(`export (interface|type) ${name}\b`), `${name} e definit in appRuntimeContracts.ts`);
  }
  const runtime = read("appRuntime.ts");
  assert.ok(!/\nexport interface AppRuntimeDeps\b/.test(runtime), "AppRuntimeDeps nu mai e definit in appRuntime.ts");
  assert.match(runtime, /export type \{[\s\S]*?AppRuntimeDeps[\s\S]*?\} from "\.\/appRuntimeContracts\.js"/, "appRuntime.ts re-exporta contractele pentru compatibilitate");
});

test("modulele runtime importa contractele direct, nu prin composition root (fara ciclu de tipuri)", () => {
  for (const rel of ["runtime/bootSequence.ts", "runtime/runtimeSchedulers.ts", "runtime/runtimeServices.ts"]) {
    const text = read(rel);
    assert.match(text, /from "\.\.\/appRuntimeContracts\.js"/, `${rel} importa din appRuntimeContracts`);
    assert.ok(!text.includes('from "../appRuntime.js"'), `${rel} nu mai importa tipuri din appRuntime (ciclul e rupt)`);
  }
});
