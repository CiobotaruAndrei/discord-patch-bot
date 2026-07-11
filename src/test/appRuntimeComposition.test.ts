import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");

const appRoot = path.join(__dirname, "..", "..", "app");

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

