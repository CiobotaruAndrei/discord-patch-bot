import test from "node:test";
import assert from "node:assert/strict";
import { COMMAND_MODULE_DESCRIPTORS, descriptorFor } from "../features/command-catalog/commandModuleDescriptors";
import { COMMAND_ACCESS_MANIFEST, COMMAND_CATALOG_HELP } from "../features/command-catalog/commandCatalog";

test("descriptorii leaga fiecare comanda de domeniu + acces + help, fara comenzi orfane (R6 #4)", () => {
  assert.equal(COMMAND_MODULE_DESCRIPTORS.length, COMMAND_ACCESS_MANIFEST.length, "un descriptor per regula de acces");
  const helpTotal = COMMAND_MODULE_DESCRIPTORS.reduce((sum, descriptor) => sum + descriptor.help.length, 0);
  assert.equal(helpTotal, COMMAND_CATALOG_HELP.length, "toate intrarile de help sunt legate de exact un descriptor");
  for (const descriptor of COMMAND_MODULE_DESCRIPTORS) {
    assert.ok(descriptor.help.length >= 1, `${descriptor.command} are cel putin o intrare de help`);
    assert.ok(["core", "game-info", "notifications", "youtube", "admin"].includes(descriptor.domain));
    assert.equal(descriptor.access.command, descriptor.command);
  }
});

test("descriptorFor gaseste comanda cu domeniul de provenienta corect", () => {
  assert.equal(descriptorFor("youtube")?.domain, "youtube");
  assert.equal(descriptorFor("backup")?.domain, "admin");
  assert.equal(descriptorFor("price-alert")?.domain, "notifications");
  assert.equal(descriptorFor("crossplay")?.domain, "game-info");
  assert.equal(descriptorFor("ping")?.domain, "core");
  assert.equal(descriptorFor("inexistenta"), null);
});

test("agregatorul pastreaza totalurile si unicitatea comenzilor dupa split-ul pe domenii (R6 #3)", () => {
  assert.equal(COMMAND_ACCESS_MANIFEST.length, 45, "toate cele 45 de reguli de acces au supravietuit split-ului");
  assert.equal(COMMAND_CATALOG_HELP.length, 122, "toate cele 122 de intrari de help au supravietuit split-ului");
  const commands = COMMAND_ACCESS_MANIFEST.map(rule => rule.command);
  assert.equal(new Set(commands).size, commands.length, "fara comenzi duplicate intre domenii");
  const helpCommands = COMMAND_CATALOG_HELP.map(entry => entry.command);
  assert.equal(new Set(helpCommands).size, helpCommands.length, "fara intrari de help duplicate intre domenii");
});
