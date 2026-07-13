import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.join(__dirname, "..", "..", "..", "app");

test("appRuntime ramane composition root fara implementarea fazelor de boot", () => {
  const source = fs.readFileSync(path.join(appRoot, "appRuntime.ts"), "utf8");
  assert.match(source, /runtime\/bootSequence/);
  assert.match(source, /runtime\/runtimeServices/);
  assert.match(source, /runtime\/runtimeSchedulers/);
  assert.doesNotMatch(source, /async function connectMongoWithRetry/);
  assert.doesNotMatch(source, /function createRuntimeServices/);
  assert.doesNotMatch(source, /function createSchedulers/);
});

test("modulele runtime contin responsabilitatile mutate din composition root", () => {
  const boot = fs.readFileSync(path.join(appRoot, "runtime", "bootSequence.ts"), "utf8");
  const services = fs.readFileSync(path.join(appRoot, "runtime", "runtimeServices.ts"), "utf8");
  const schedulers = fs.readFileSync(path.join(appRoot, "runtime", "runtimeSchedulers.ts"), "utf8");
  assert.match(boot, /async function connectMongoWithRetry/);
  assert.match(services, /function createRuntimeServices/);
  assert.match(schedulers, /function createSchedulers/);
});

