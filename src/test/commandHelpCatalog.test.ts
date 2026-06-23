import test from "node:test";
import assert from "node:assert/strict";

import { COMMAND_HELP_ENTRIES, normalizeCommandHelpQuery, buildCommandHelpChoices, findCommandHelpEntry, renderCommandHelpEntry } from "../features/command-help/commandHelpCatalog";

const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

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
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as (t: Record<string, unknown>) => void;
  attachSlashCommands(target);
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
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as (t: Record<string, unknown>) => void;
  attachSlashCommands(target);
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

test("command help catalog: permisiunea declarata (Admin/Public) coincide cu setDefaultMemberPermissions din slash definitions", () => {
  const admin = adminTopLevelCommands();
  assert.ok(admin.size > 0, "slash definitions au comenzi admin (sanity)");
  for (const entry of COMMAND_HELP_ENTRIES) {
    const topLevel = entry.command.replace(/^\//, "").split(/\s+/)[0];
    const isAdmin = admin.has(topLevel);
    assert.equal(entry.permissions.startsWith("Admin"), isAdmin, `${entry.command}: catalogul declara permisiunea "${entry.permissions}" dar slash definitions impun ${isAdmin ? "Admin" : "Public"} (drift de permisiuni)`);
  }
});

test("command help catalog raspunde la input cu sau fara slash", () => {
  const entry = findCommandHelpEntry("set games add");
  assert.ok(entry);
  assert.equal(entry.command, "/set games add");
  assert.match(renderCommandHelpEntry(entry), /Permisiuni: Admin/);
});

test("command help autocomplete filtreaza si pastreaza valori selectabile", () => {
  const choices = buildCommandHelpChoices("recovery");
  assert.ok(choices.some(choice => choice.value === "/outbox recovery-verify status"));
  for (const choice of choices) {
    assert.ok(choice.name.length <= 100);
    assert.ok(choice.value.startsWith("/"));
  }
});
