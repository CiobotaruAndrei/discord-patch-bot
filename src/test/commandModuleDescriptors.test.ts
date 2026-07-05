import test from "node:test";
import assert from "node:assert/strict";
import { COMMAND_MODULE_DESCRIPTORS, descriptorFor } from "../features/command-catalog/commandModuleDescriptors";
import { COMMAND_ACCESS_MANIFEST, COMMAND_CATALOG_HELP } from "../features/command-catalog/commandCatalog";
import { CORE_COMMAND_ACCESS, CORE_CATALOG_HELP } from "../features/command-catalog/coreCatalog";
import { GAME_INFO_COMMAND_ACCESS, GAME_INFO_CATALOG_HELP } from "../features/command-catalog/gameInfoCatalog";
import { NOTIFICATIONS_COMMAND_ACCESS, NOTIFICATIONS_CATALOG_HELP } from "../features/command-catalog/notificationsCatalog";
import { YOUTUBE_COMMAND_ACCESS, YOUTUBE_CATALOG_HELP } from "../features/command-catalog/youtubeCatalog";
import { ADMIN_COMMAND_ACCESS, ADMIN_CATALOG_HELP } from "../features/command-catalog/adminCatalog";

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

test("agregatorul pastreaza totalurile si unicitatea comenzilor dupa split-ul pe domenii (R6 #3, semantic R7 #12)", () => {
  const accessDomains = [CORE_COMMAND_ACCESS, GAME_INFO_COMMAND_ACCESS, NOTIFICATIONS_COMMAND_ACCESS, YOUTUBE_COMMAND_ACCESS, ADMIN_COMMAND_ACCESS];
  const helpDomains = [CORE_CATALOG_HELP, GAME_INFO_CATALOG_HELP, NOTIFICATIONS_CATALOG_HELP, YOUTUBE_CATALOG_HELP, ADMIN_CATALOG_HELP];
  for (const rules of accessDomains) assert.ok(rules.length >= 1, "fiecare domeniu contribuie cel putin o regula de acces");
  for (const entries of helpDomains) assert.ok(entries.length >= 1, "fiecare domeniu contribuie cel putin o intrare de help");
  assert.equal(
    COMMAND_ACCESS_MANIFEST.length,
    accessDomains.reduce((sum, rules) => sum + rules.length, 0),
    "agregatul de acces este exact suma cataloagelor pe domenii, fara pierderi sau dublari"
  );
  assert.equal(
    COMMAND_CATALOG_HELP.length,
    helpDomains.reduce((sum, entries) => sum + entries.length, 0),
    "agregatul de help este exact suma cataloagelor pe domenii, fara pierderi sau dublari"
  );
  const commands = COMMAND_ACCESS_MANIFEST.map(rule => rule.command);
  assert.equal(new Set(commands).size, commands.length, "fara comenzi duplicate intre domenii");
  const helpCommands = COMMAND_CATALOG_HELP.map(entry => entry.command);
  assert.equal(new Set(helpCommands).size, helpCommands.length, "fara intrari de help duplicate intre domenii");
});

const MANDATORY_COMMANDS: ReadonlyArray<{ command: string; domain: string }> = [
  { command: "ping", domain: "core" },
  { command: "help", domain: "core" },
  { command: "games", domain: "core" },
  { command: "crossplay", domain: "game-info" },
  { command: "price-check", domain: "game-info" },
  { command: "start", domain: "notifications" },
  { command: "stop", domain: "notifications" },
  { command: "set", domain: "notifications" },
  { command: "sources", domain: "notifications" },
  { command: "price-alert", domain: "notifications" },
  { command: "watchlist", domain: "notifications" },
  { command: "youtube", domain: "youtube" },
  { command: "backup", domain: "admin" },
  { command: "reset-config", domain: "admin" },
  { command: "admin-command-access", domain: "admin" },
  { command: "maintenance", domain: "admin" }
];

test("comenzile obligatorii raman prezente in manifest, fiecare in domeniul ei (R7 #12)", () => {
  for (const { command, domain } of MANDATORY_COMMANDS) {
    assert.equal(descriptorFor(command)?.domain, domain, `/${command} este prezenta in domeniul ${domain}`);
    assert.ok((descriptorFor(command)?.help.length ?? 0) >= 1, `/${command} are help sincronizat`);
  }
});
