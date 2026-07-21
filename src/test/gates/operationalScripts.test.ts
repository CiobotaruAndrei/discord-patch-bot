import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const packageText = fs.readFileSync(path.join(srcRoot, "package.json"), "utf8");

function scriptValue(name: string): string {
  const match = packageText.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
  assert.ok(match, `Scriptul ${name} trebuie sa existe`);
  return match[1];
}

test("scripturile operationale compileaza o singura data si ruleaza gate-urile direct", () => {
  assert.equal(scriptValue("check:quick"), "npm run build:ts && node dist/scripts/check-syntax.js && node dist/scripts/check-config.js");
  assert.equal(scriptValue("lint"), "npm run build:ts && node dist/scripts/check-syntax.js && node dist/scripts/check-no-comments.js && node dist/scripts/check-no-nul-bytes.js && node dist/scripts/check-no-weakening-types.js");
  const checkScript = scriptValue("check");
  assert.equal(checkScript.startsWith("npm run build:ts && npm run build:rust && "), true);
  assert.equal(checkScript.includes("npm run typecheck"), false);
  assert.equal(checkScript.includes("npm run build &&"), false);
  assert.equal(scriptValue("check:full"), "npm run check && npm run check:native && npm run test:e2e:prebuilt");
  assert.equal(packageText.includes('"test:functional"'), false);
});

test("check e un orchestrator: construieste O DATA si deleaga la variantele prebuilt (review nou #21/#22)", () => {
  assert.equal(scriptValue("check"), "npm run build:ts && npm run build:rust && npm run check:prebuilt", "check = build complet + verificari prebuilt, fara gate-uri duplicate inline");
  const prebuilt = scriptValue("check:prebuilt");
  assert.equal(prebuilt.includes("build:"), false, "check:prebuilt nu construieste nimic - ruleaza pe artefactele existente");
  assert.equal(prebuilt.startsWith("node dist/scripts/run-gates.js && "), true, "gate-urile ruleaza direct pe dist, in paralel, printr-un singur orchestrator");
  assert.ok(prebuilt.includes("node --test"), "check:prebuilt include si testele");
  assert.equal(scriptValue("check:ts-prebuilt"), "npm run build:ts && npm run check:prebuilt", "check:ts-prebuilt reconstruieste doar TypeScript si refoloseste addon-ul nativ deja construit");
});

test("scripturile locale incarca .env si separa rolurile web si worker", () => {
  assert.equal(scriptValue("dev"), "npm run build && npm run start:local");
  assert.equal(scriptValue("start:web"), "node dist/app/web.js");
  assert.equal(scriptValue("start:web:local"), "node --env-file=.env dist/app/web.js");
  assert.equal(scriptValue("check:env:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-env.js");
  assert.equal(scriptValue("check:redis:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-redis.js");
  assert.equal(scriptValue("check:mongo:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-mongo.js");
  assert.equal(scriptValue("doctor:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-env.js && node --env-file=.env dist/scripts/check-config.js && node --env-file=.env dist/scripts/check-mongo.js && node --env-file=.env dist/scripts/check-redis.js");
});

test("exportul brut al guild-urilor este explicit", () => {
  assert.equal(scriptValue("db:export:guilds"), "npm run build:ts && node dist/scripts/export-guild-configs.js");
  assert.equal(scriptValue("db:export:guilds:raw"), "npm run build:ts && node dist/scripts/export-guild-configs.js --raw");
});

test("entrypoint-ul web porneste exclusiv rolul web", () => {
  const webEntry = fs.readFileSync(path.join(srcRoot, "app", "web.ts"), "utf8");
  assert.match(webEntry, /import \{ startBot \} from "\.\/bootstrap\.js";/);
  assert.match(webEntry, /startBot\("web"\);/);
});
