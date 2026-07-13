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
  assert.equal(scriptValue("lint"), "npm run build:ts && node dist/scripts/check-syntax.js && node dist/scripts/check-no-comments.js && node dist/scripts/check-no-weakening-types.js");
  assert.equal(scriptValue("check:full"), "npm run check && npm run check:native && npm run test:e2e:prebuilt");
  assert.equal(packageText.includes('"test:functional"'), false);
});

test("scripturile locale incarca .env si separa rolurile web si worker", () => {
  assert.equal(scriptValue("dev"), "npm run build && npm run start:local");
  assert.equal(scriptValue("start:web"), "node dist/app/web.js");
  assert.equal(scriptValue("start:web:local"), "node --env-file=.env dist/app/web.js");
  assert.equal(scriptValue("check:env:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-env.js");
  assert.equal(scriptValue("check:redis:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-redis.js");
  assert.equal(scriptValue("doctor:local"), "npm run build:ts && node --env-file=.env dist/scripts/check-env.js && node --env-file=.env dist/scripts/check-config.js && node --env-file=.env dist/scripts/check-redis.js");
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
