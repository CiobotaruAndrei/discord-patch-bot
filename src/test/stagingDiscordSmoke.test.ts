import test from "node:test";
import assert from "node:assert/strict";

const smoke = require("../scripts/stagingDiscordSmoke") as {
  evaluateCommands: (registered: Array<{ name?: string }>, requiredAny?: string[]) => { ok: boolean; count: number; missing: string[] };
  evaluatePermissions: (grantedNames: string[], requiredNames?: string[]) => { ok: boolean; missing: string[] };
  isSendableSmokeChannel: (channel: unknown) => boolean;
  sendabilityFailureDetail: (channel: unknown) => string;
  expectedCommandNames: () => string[];
  REQUIRED_COMMANDS: string[];
  REQUIRED_PERMISSIONS: string[];
};

test("REQUIRED_COMMANDS = exact suprafata din buildSlashCommandDefinitions, nu o lista scrisa de mana (review #2)", () => {
  assert.deepEqual(smoke.REQUIRED_COMMANDS, smoke.expectedCommandNames(),
    "regresie: smoke-ul cerea doar ping si help -> /start, /stop, /set, /latest, /status, /outbox puteau lipsi din staging fara ca smoke-ul sa pice");
  for (const critical of ["ping", "help", "start", "stop", "set", "latest", "status", "outbox"]) {
    assert.ok(smoke.REQUIRED_COMMANDS.includes(critical), `comanda critica verificata de smoke: /${critical}`);
  }
  assert.ok(smoke.REQUIRED_COMMANDS.length >= 8, "suprafata completa de comenzi, nu un subset");
});

test("evaluateCommands: toate comenzile definite inregistrate -> ok", () => {
  const registered = smoke.expectedCommandNames().map(name => ({ name }));
  const result = smoke.evaluateCommands(registered);
  assert.equal(result.ok, true);
  assert.equal(result.count, registered.length);
  assert.deepEqual(result.missing, []);
});

test("evaluateCommands: o comanda definita lipsa din registru sau set gol -> fail", () => {
  const withoutOutbox = smoke.expectedCommandNames().filter(name => name !== "outbox").map(name => ({ name }));
  const missingOutbox = smoke.evaluateCommands(withoutOutbox);
  assert.equal(missingOutbox.ok, false);
  assert.deepEqual(missingOutbox.missing, ["outbox"]);

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

test("isSendableSmokeChannel: type guard real - canal text cu send trece, restul pica cu motiv explicit (review #14.1 + #16.4)", () => {
  assert.equal(smoke.isSendableSmokeChannel({ isTextBased: () => true, send: async () => undefined }), true);
  assert.equal(smoke.isSendableSmokeChannel({ isTextBased: () => false, send: async () => undefined }), false);
  assert.match(smoke.sendabilityFailureDetail({ isTextBased: () => false, send: async () => undefined }), /text-based/);
  assert.equal(smoke.isSendableSmokeChannel({ isTextBased: () => true }), false);
  assert.match(smoke.sendabilityFailureDetail({ isTextBased: () => true }), /send/);
  assert.equal(smoke.isSendableSmokeChannel(null), false);
  assert.match(smoke.sendabilityFailureDetail(null), /text-based/);
});

test("constantele expun permisiunile cheie verificate", () => {
  for (const perm of ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"]) {
    assert.ok(smoke.REQUIRED_PERMISSIONS.includes(perm), `permisiune verificata: ${perm}`);
  }
});
