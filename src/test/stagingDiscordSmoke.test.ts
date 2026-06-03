import test from "node:test";
import assert from "node:assert/strict";

const smoke = require("../scripts/stagingDiscordSmoke") as {
  evaluateCommands: (registered: Array<{ name?: string }>, requiredAny?: string[]) => { ok: boolean; count: number; missing: string[] };
  evaluatePermissions: (grantedNames: string[], requiredNames?: string[]) => { ok: boolean; missing: string[] };
  REQUIRED_COMMANDS: string[];
  REQUIRED_PERMISSIONS: string[];
};

test("evaluateCommands: comenzile cheie inregistrate -> ok", () => {
  const registered = [{ name: "ping" }, { name: "help" }, { name: "latest" }, { name: "start" }];
  const result = smoke.evaluateCommands(registered);
  assert.equal(result.ok, true);
  assert.equal(result.count, 4);
  assert.deepEqual(result.missing, []);
});

test("evaluateCommands: lipsa unei comenzi cheie sau set gol -> fail", () => {
  const missingHelp = smoke.evaluateCommands([{ name: "ping" }, { name: "latest" }]);
  assert.equal(missingHelp.ok, false);
  assert.deepEqual(missingHelp.missing, ["help"]);

  const empty = smoke.evaluateCommands([]);
  assert.equal(empty.ok, false, "niciun slash command inregistrat -> fail");
  assert.equal(empty.count, 0);
});

test("evaluatePermissions: toate permisiunile necesare prezente -> ok", () => {
  const granted = ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory", "AddReactions"];
  const result = smoke.evaluatePermissions(granted);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("evaluatePermissions: permisiuni lipsa sunt raportate", () => {
  const granted = ["ViewChannel", "SendMessages"];
  const result = smoke.evaluatePermissions(granted);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["EmbedLinks", "ReadMessageHistory"]);
});

test("constantele expun comenzile si permisiunile cheie verificate", () => {
  assert.ok(smoke.REQUIRED_COMMANDS.includes("ping") && smoke.REQUIRED_COMMANDS.includes("help"));
  for (const perm of ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"]) {
    assert.ok(smoke.REQUIRED_PERMISSIONS.includes(perm), `permisiune verificata: ${perm}`);
  }
});
