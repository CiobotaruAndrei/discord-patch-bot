import test from "node:test";
import assert from "node:assert/strict";

const smoke = require("../scripts/stagingDiscordSmoke") as {
  evaluateCommands: (registered: Array<{ name?: string }>, requiredAny?: string[]) => { ok: boolean; count: number; missing: string[] };
  evaluatePermissions: (grantedNames: string[], requiredNames?: string[]) => { ok: boolean; missing: string[] };
  evaluateSendability: (channel: unknown) => { sendable: true } | { sendable: false; detail: string };
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

test("evaluateSendability: canal text cu send -> sendable; non-text sau fara send -> fail explicit (review #14.1)", () => {
  assert.deepEqual(smoke.evaluateSendability({ isTextBased: () => true, send: async () => undefined }), { sendable: true });
  const nonText = smoke.evaluateSendability({ isTextBased: () => false, send: async () => undefined });
  assert.equal(nonText.sendable, false);
  assert.match((nonText as { detail: string }).detail, /text-based/);
  const noSend = smoke.evaluateSendability({ isTextBased: () => true });
  assert.equal(noSend.sendable, false);
  assert.match((noSend as { detail: string }).detail, /send/);
  assert.equal(smoke.evaluateSendability(null).sendable, false);
});

test("constantele expun permisiunile cheie verificate", () => {
  for (const perm of ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"]) {
    assert.ok(smoke.REQUIRED_PERMISSIONS.includes(perm), `permisiune verificata: ${perm}`);
  }
});
