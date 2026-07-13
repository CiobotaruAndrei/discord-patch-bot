import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMAND_ACCESS_MANIFEST,
  COMMAND_CATALOG_HELP,
  permissionsLabelFor
} from "../features/command-catalog/commandCatalog.js";
import { COMMAND_HELP_ENTRIES } from "../features/command-help/commandHelpCatalog.js";

const KNOWN_LABELS = new Set([
  "Public",
  "Public, Ephemeral",
  "Admin, Ephemeral",
  "Admin runtime, Ephemeral",
  "Admin top-level, owner-only runtime, Ephemeral"
]);

test("permissionsLabelFor deriva eticheta din faptele de acces: public, public ephemeral, admin discord, admin runtime, owner-only", () => {
  assert.equal(permissionsLabelFor("/ping"), "Public");
  assert.equal(permissionsLabelFor("/history", true), "Public, Ephemeral");
  assert.equal(permissionsLabelFor("/backup load"), "Admin, Ephemeral");
  assert.equal(permissionsLabelFor("/add backup"), "Admin runtime, Ephemeral");
  assert.equal(permissionsLabelFor("/add suggestion", true), "Public, Ephemeral");
  assert.equal(permissionsLabelFor("/report list"), "Admin runtime, Ephemeral");
  assert.equal(permissionsLabelFor("/set admin-command-access"), "Admin top-level, owner-only runtime, Ephemeral");
  assert.equal(permissionsLabelFor("/admin-command-access list"), "Admin top-level, owner-only runtime, Ephemeral");
});

test("toate etichetele generate pentru intrarile din catalog au una dintre formele cunoscute", () => {
  for (const entry of COMMAND_HELP_ENTRIES) {
    assert.ok(KNOWN_LABELS.has(entry.permissions), `eticheta necunoscuta pentru ${entry.command}: ${entry.permissions}`);
  }
});

test("flag-ul ephemeral din catalog exista doar pe caile cu acces public (la admin/owner e implicit prin regula 7)", () => {
  const adminOnly = new Set(
    COMMAND_ACCESS_MANIFEST.filter(rule => rule.access === "admin").map(rule => rule.command)
  );
  for (const entry of COMMAND_CATALOG_HELP.filter(item => item.ephemeral === true)) {
    const command = entry.command.replace(/^\/+/, "").split(" ")[0];
    const sub = entry.command.replace(/^\/+/, "").split(" ")[1] ?? "";
    const rule = COMMAND_ACCESS_MANIFEST.find(item => item.command === command);
    const isPublicPath = !adminOnly.has(command) || (rule?.publicSubcommands?.includes(sub) ?? false);
    assert.ok(isPublicPath, `${entry.command} are flag ephemeral desi calea nu e publica`);
    assert.equal(permissionsLabelFor(entry.command, entry.ephemeral), "Public, Ephemeral");
  }
});

test("fiecare comanda din manifest are cel putin o intrare de help in catalog si invers", () => {
  const helpCommands = new Set(COMMAND_CATALOG_HELP.map(entry => entry.command.replace(/^\/+/, "").split(" ")[0]));
  for (const rule of COMMAND_ACCESS_MANIFEST) {
    assert.ok(helpCommands.has(rule.command), `comanda ${rule.command} din manifest nu are nicio intrare de help`);
  }
  const manifestCommands = new Set(COMMAND_ACCESS_MANIFEST.map(rule => rule.command));
  for (const command of helpCommands) {
    assert.ok(manifestCommands.has(command), `intrarea de help /${command} nu are regula de acces in manifest`);
  }
});
