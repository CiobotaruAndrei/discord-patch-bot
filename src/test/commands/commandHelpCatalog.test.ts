import attachSlashCommands from "../../features/command-definitions/slashCommandDefinitions.js";
import { moduleContext } from "../moduleContextStub.js";
import test from "node:test";
import assert from "node:assert/strict";

import { COMMAND_HELP_ENTRIES, normalizeCommandHelpQuery, buildCommandHelpChoices, findCommandHelpEntry, renderCommandHelpEntry } from "../../features/command-help/commandHelpCatalog.js";

import { SlashCommandBuilder, PermissionsBitField } from "discord.js";
import fs from "fs";
import path from "path";

interface SlashJsonOption { type: number; name: string; options?: SlashJsonOption[] }
interface SlashJsonCommand { name: string; options?: SlashJsonOption[] }

function slashCommandPaths(): string[] {
  const target: Record<string, unknown> = {
    SlashCommandBuilder,
    PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    env: {}
  };
  attachSlashCommands(moduleContext<Parameters<typeof attachSlashCommands>[0]>(target));
  const defs = (target.buildSlashCommandDefinitions as () => SlashJsonCommand[])();
  const paths: string[] = [];
  for (const command of defs) {
    const options = command.options || [];
    const nested = options.some(option => option.type === 1 || option.type === 2);
    if (!nested) {
      paths.push(`/${command.name}`);
      continue;
    }
    for (const option of options) {
      if (option.type === 1) paths.push(`/${command.name} ${option.name}`);
      if (option.type === 2) {
        for (const subcommand of option.options || []) {
          if (subcommand.type === 1) paths.push(`/${command.name} ${option.name} ${subcommand.name}`);
        }
      }
    }
  }
  return paths;
}

function adminTopLevelCommands(): Set<string> {
  const target: Record<string, unknown> = {
    SlashCommandBuilder,
    PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    env: {}
  };
  attachSlashCommands(moduleContext<Parameters<typeof attachSlashCommands>[0]>(target));
  const defs = (target.buildSlashCommandDefinitions as () => Array<{ name: string; default_member_permissions?: string | number | null }>)();
  const admin = new Set<string>();
  for (const def of defs) {
    if (def.default_member_permissions != null) admin.add(def.name);
  }
  return admin;
}

test("command help catalog acopera toate slash command paths", () => {
  const helpPaths = new Set(COMMAND_HELP_ENTRIES.map(entry => normalizeCommandHelpQuery(entry.command)));
  for (const path of slashCommandPaths()) {
    assert.ok(helpPaths.has(normalizeCommandHelpQuery(path)), `lipseste help entry pentru ${path}`);
  }
});

test("command help catalog: fiecare entry corespunde unei comenzi reale din slash definitions (fara entries stale)", () => {
  const realPaths = new Set(slashCommandPaths().map(normalizeCommandHelpQuery));
  for (const entry of COMMAND_HELP_ENTRIES) {
    assert.ok(realPaths.has(normalizeCommandHelpQuery(entry.command)), `entry de catalog pentru comanda inexistenta (drift): ${entry.command}`);
  }
});

function normalizeDocCommand(command: string): string {
  return command.replace(/\s+[a-z]+:.*$/, "").replace(/\s+<.*$/, "").trim();
}

test("command help catalog: setul de comenzi din tabelul docs/Comenzi Functionalitate.md coincide BIDIRECTIONAL cu catalogul (anti-drift, nu doar includes)", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "..", "docs", "Comenzi Functionalitate.md"), "utf8");
  const docCommands = new Set<string>();
  for (const match of doc.matchAll(/^\|\s*`(\/[^`]+)`/gm)) docCommands.add(normalizeDocCommand(match[1]));
  const catalogCommands = new Set(COMMAND_HELP_ENTRIES.map(entry => normalizeDocCommand(entry.command)));
  assert.ok(docCommands.size > 10, "tabelul de comenzi a fost parsat");

  for (const command of catalogCommands) {
    assert.ok(docCommands.has(command), `docs/Comenzi Functionalitate.md nu documenteaza comanda din catalog: ${command}`);
  }
  for (const command of docCommands) {
    assert.ok(catalogCommands.has(command), `docs/Comenzi Functionalitate.md documenteaza o comanda care nu mai e in catalogul /help (entry stale): ${command}`);
  }
});

test("command help catalog: permisiunea declarata (Admin/Public) coincide cu setDefaultMemberPermissions din slash definitions", () => {
  const admin = adminTopLevelCommands();
  assert.ok(admin.size > 0, "slash definitions au comenzi admin (sanity)");
  for (const entry of COMMAND_HELP_ENTRIES) {
    const topLevel = entry.command.replace(/^\//, "").split(/\s+/)[0];
    const isAdmin = admin.has(topLevel);
    const runtimeAdmin = entry.permissions.includes("Admin runtime");
    assert.equal(entry.permissions.startsWith("Admin") && !runtimeAdmin, isAdmin, `${entry.command}: catalogul declara permisiunea "${entry.permissions}" dar slash definitions impun ${isAdmin ? "Admin" : "Public"} la nivel top-level`);
  }
});

test("command help catalog raspunde la input cu sau fara slash", () => {
  const entry = findCommandHelpEntry("set add games");
  assert.ok(entry);
  assert.equal(entry.command, "/set add games");
  assert.match(renderCommandHelpEntry(entry), /Permisiuni: Admin/);
});

test("command help autocomplete filtreaza si pastreaza valori selectabile", () => {
  const choices = buildCommandHelpChoices("overview");
  assert.ok(choices.some(choice => choice.value === "/game overview"));
  for (const choice of choices) {
    assert.ok(choice.name.length <= 100);
    assert.ok(choice.value.startsWith("/"));
  }
});

test("command help catalog: descrierea /youtube notify channel mentioneaza si View Channel (codul + docs o cer) (R[Low] #4)", () => {
  const entry = COMMAND_HELP_ENTRIES.find(e => e.command === "/youtube notify channel");
  assert.ok(entry, "exista un entry pentru /youtube notify channel");
  assert.match(entry!.description, /View Channel/, "handler-ul blocheaza configurarea fara View Channel, deci help-ul trebuie sa o listeze");
});

test("command help catalog documenteaza suita noua fara rute eliminate", () => {
  const paths = new Set(COMMAND_HELP_ENTRIES.map(entry => entry.command));
  for (const current of ["/game overview", "/status watchlist", "/template set", "/notification preview", "/report complaint"]) {
    assert.ok(paths.has(current), `exista intrarea ${current}`);
  }
  for (const removed of ["/history", "/outbox deadletters", "/youtube videos show", "/youtube permissions"]) {
    assert.equal(paths.has(removed), false, `${removed} a fost eliminata din help`);
  }
});
