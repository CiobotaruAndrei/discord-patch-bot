import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
import test from "node:test";
import assert from "node:assert/strict";

import path from "path";

interface Classifiers {
  isCode: (f: string) => boolean;
  isDoc: (f: string) => boolean;
  isTest: (f: string) => boolean;
  isInfra: (f: string) => boolean;
}

const classifiersPath = path.resolve(__dirname, "../../../../.github/scripts/pr-checklist-file-classifiers.js");
const { isCode, isDoc, isTest, isInfra } = require(classifiersPath) as Classifiers;

test("isInfra prinde config-ul real de sub src/ (R13 #3), nu doar pe cel de la root", () => {
  assert.equal(isInfra("src/config.json"), true, "src/config.json este config-ul real al botului");
  assert.equal(isInfra("src/config.schema.json"), true, "src/config.schema.json este schema config-ului");
  assert.equal(isInfra("config.json"), true, "varianta de la root ramane acoperita");
  assert.equal(isInfra("config.schema.json"), true, "schema de la root ramane acoperita");
});

test("isInfra acopera Dockerfile, workflows, monitoring", () => {
  assert.equal(isInfra("Dockerfile"), true);
  assert.equal(isInfra("Dockerfile.prod"), true);
  assert.equal(isInfra("docker-compose.yml"), true);
  assert.equal(isInfra(".github/workflows/ci.yml"), true);
  assert.equal(isInfra(".github/workflows/pr-checklist.yml"), true);
  assert.equal(isInfra("monitoring/grafana-dashboard.json"), true);
  assert.equal(isInfra("monitoring/prometheus-alerts.yml"), true);
});

test("isInfra NU clasifica codul aplicatiei sau testele ca infra", () => {
  assert.equal(isInfra("src/features/notifications/notificationOutbox.ts"), false);
  assert.equal(isInfra("src/test/notificationOutbox.test.ts"), false);
  assert.equal(isInfra("README.md"), false);
  assert.equal(isInfra("src/data.json"), false, "un json oarecare de sub src nu e config de infra");
});

test("isCode acopera src/**.ts|js (fara teste) si native rust", () => {
  assert.equal(isCode("src/features/x.ts"), true);
  assert.equal(isCode("src/index.js"), true);
  assert.equal(isCode("src/native/lib.rs"), true);
  assert.equal(isCode("src/test/x.test.ts"), false, "testele nu sunt cod de productie");
  assert.equal(isCode("README.md"), false);
});

test("isDoc acopera .md si ambele cai pentru .env.example (root + src/)", () => {
  assert.equal(isDoc("README.md"), true);
  assert.equal(isDoc("docs/Comenzi Functionalitate.md"), true);
  assert.equal(isDoc(".env.example"), true);
  assert.equal(isDoc("src/.env.example"), true, "fisierul real e sub src/, deci trebuie recunoscut ca documentatie");
});

test("isTest recunoaste doar src/test/**", () => {
  assert.equal(isTest("src/test/x.test.ts"), true);
  assert.equal(isTest("src/features/x.ts"), false);
});
