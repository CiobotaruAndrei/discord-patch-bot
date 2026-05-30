import test from "node:test";
import assert from "node:assert/strict";
import { runStagingSmoke } from "../scripts/staging-smoke";
import type { StagingSmokeDeps } from "../scripts/staging-smoke";

function makeDeps(overrides: Partial<StagingSmokeDeps> = {}): StagingSmokeDeps {
  return {
    logger: () => undefined,
    connectMongo: async () => undefined,
    isMongoReady: () => true,
    runMigrations: async () => ({ applied: [1], skipped: 0 }),
    loginDiscord: async () => undefined,
    isDiscordReady: () => true,
    registerGuildCommands: async () => undefined,
    fetchOneSource: async () => ({ ok: true, detail: "cs2 -> patch" }),
    sendTestMessage: async () => undefined,
    devGuildId: "dev-guild",
    testChannelId: "test-channel",
    ...overrides
  };
}

test("staging smoke: all steps pass -> ok with the full step list", async () => {
  const result = await runStagingSmoke(makeDeps());
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map(step => step.name), [
    "mongo-connect", "migrations", "discord-login", "register-guild-commands", "fetch-source", "send-test-message"
  ]);
  assert.ok(result.steps.every(step => step.ok));
});

test("staging smoke: stops at the first failing step", async () => {
  let loginCalled = false;
  const result = await runStagingSmoke(makeDeps({
    runMigrations: async () => { throw new Error("migration boom"); },
    loginDiscord: async () => { loginCalled = true; }
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.steps.map(step => step.name), ["mongo-connect", "migrations"]);
  assert.equal(result.steps[1].ok, false);
  assert.match(result.steps[1].detail, /migration boom/);
  assert.equal(loginCalled, false, "nu continua dupa un esec");
});

test("staging smoke: optional steps are skipped when ids are missing", async () => {
  let registerCalled = false;
  let sendCalled = false;
  const result = await runStagingSmoke(makeDeps({
    devGuildId: undefined,
    testChannelId: undefined,
    registerGuildCommands: async () => { registerCalled = true; },
    sendTestMessage: async () => { sendCalled = true; }
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map(step => step.name), ["mongo-connect", "migrations", "discord-login", "fetch-source"]);
  assert.equal(registerCalled, false);
  assert.equal(sendCalled, false);
});

test("staging smoke: a not-ready mongo connection fails fast", async () => {
  const result = await runStagingSmoke(makeDeps({ isMongoReady: () => false }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.steps.map(step => step.name), ["mongo-connect"]);
  assert.equal(result.steps[0].ok, false);
});

test("staging smoke: a non-ok fetch result fails the fetch step", async () => {
  const result = await runStagingSmoke(makeDeps({
    fetchOneSource: async () => ({ ok: false, detail: "Steam gol" })
  }));
  assert.equal(result.ok, false);
  const fetchStep = result.steps.find(step => step.name === "fetch-source");
  assert.ok(fetchStep && !fetchStep.ok);
  assert.match(fetchStep.detail, /Steam gol/);
});
