import test from "node:test";
import assert from "node:assert/strict";

import { COMMAND_HELP_ENTRIES, normalizeCommandHelpQuery, buildCommandHelpChoices, buildAdminCommandScopeChoices, listAdminCommandScopePaths, findCommandHelpEntry, renderCommandHelpEntry } from "../features/command-help/commandHelpCatalog";
import { REPORT_TYPE_VALUES } from "../features/feedback/reportTypes";

const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

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

function reportTipChoiceValues(): string[] {
  const target: Record<string, unknown> = {
    SlashCommandBuilder,
    PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    env: {}
  };
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as (t: Record<string, unknown>) => void;
  attachSlashCommands(target);
  const defs = (target.buildSlashCommandDefinitions as () => Array<{ name: string; options?: Array<{ name: string; choices?: Array<{ value: string }>; options?: Array<{ name: string; choices?: Array<{ value: string }> }> }> }>)();
  const report = defs.find(def => def.name === "report");
  const submit = report?.options?.find(option => option.name === "submit");
  const tip = submit?.options?.find(option => option.name === "tip");
  return (tip?.choices || []).map(choice => choice.value);
}

test("command help catalog: exemplul /report submit foloseste o optiune tip reala (sursa unica REPORT_TYPES, fara slug inventat)", () => {
  const reportEntry = COMMAND_HELP_ENTRIES.find(entry => entry.command === "/report submit");
  assert.ok(reportEntry, "exista intrarea /report submit in catalog");
  const match = /\btip:(\S+)/.exec(reportEntry.example);
  assert.ok(match, "exemplul /report contine o optiune tip:<valoare>");
  const tipValue = match[1];
  const slashChoiceValues = reportTipChoiceValues();
  assert.ok(slashChoiceValues.length > 0, "comanda slash /report expune choices pentru tip");
  assert.deepEqual(slashChoiceValues, [...REPORT_TYPE_VALUES], "choice-urile slash /report provin din sursa unica REPORT_TYPES");
  assert.ok(slashChoiceValues.includes(tipValue), `tip:${tipValue} din exemplu nu e o optiune reala (${slashChoiceValues.join(", ")})`);
});

test("admin command scope catalog: contine doar comenzi admin + global, nu comenzi publice (R[P2] #2)", () => {
  const paths = listAdminCommandScopePaths();
  assert.ok(paths.length > 5, "exista comenzi admin in catalog");
  assert.ok(paths.includes("/start updates"), "o comanda admin reala e in catalogul de scope-uri");
  assert.ok(paths.includes("/backup load"), "o comanda admin cu subcomanda e in catalog");
  for (const publicCommand of ["/ping", "/games", "/help", "/player-count game", "/top active games", "/add suggestion"]) {
    assert.equal(paths.includes(publicCommand), false, `${publicCommand} e publica si NU trebuie sa fie un scope admin restrictionabil`);
  }
});

test("admin command scope autocomplete: ofera global + comenzi admin reale si exclude comenzile publice (R[P2] #2)", () => {
  const all = buildAdminCommandScopeChoices("");
  assert.equal(all[0]?.value, "global", "prima optiune e regula globala");
  const values = all.map(choice => choice.value);
  for (const publicCommand of ["/ping", "/player-count game", "/top active games"]) {
    assert.equal(values.includes(publicCommand), false, `autocomplete-ul nu sugereaza comanda publica ${publicCommand}`);
  }
  const startChoices = buildAdminCommandScopeChoices("start updates").map(choice => choice.value);
  assert.ok(startChoices.includes("/start updates"), "autocomplete-ul sugereaza comanda admin reala cautata");
  const filtered = buildAdminCommandScopeChoices("backup");
  assert.ok(filtered.length > 0, "filtrarea dupa input intoarce potriviri");
  assert.ok(filtered.every(choice => choice.value === "global" || choice.value.includes("backup")), "toate potrivirile pentru `backup` sunt scope-uri de backup (sau global)");
});

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
  const choices = buildCommandHelpChoices("recovery");
  assert.ok(choices.some(choice => choice.value === "/outbox recovery-verify status"));
  for (const choice of choices) {
    assert.ok(choice.name.length <= 100);
    assert.ok(choice.value.startsWith("/"));
  }
});

test("command help catalog: descrierea /history mentioneaza si YouTube (def + handler suporta tip:youtube) (R[Low] #3)", () => {
  const entry = COMMAND_HELP_ENTRIES.find(e => e.command === "/history");
  assert.ok(entry, "exista un entry pentru /history");
  assert.match(entry!.description, /youtube/i, "tip:youtube exista in slash definitions si in handler, deci help-ul trebuie sa-l mentioneze");
});

test("command help catalog: descrierea /youtube notify channel mentioneaza si View Channel (codul + docs o cer) (R[Low] #4)", () => {
  const entry = COMMAND_HELP_ENTRIES.find(e => e.command === "/youtube notify channel");
  assert.ok(entry, "exista un entry pentru /youtube notify channel");
  assert.match(entry!.description, /View Channel/, "handler-ul blocheaza configurarea fara View Channel, deci help-ul trebuie sa o listeze");
});

test("command help catalog: descrierea /youtube permissions mentioneaza si rutele speciale, nu doar canalul principal (R12 #5, aliniere cu implementarea)", () => {
  const entry = COMMAND_HELP_ENTRIES.find(e => e.command === "/youtube permissions");
  assert.ok(entry, "exista un entry pentru /youtube permissions");
  assert.match(entry!.description, /rute/i, "implementarea verifica si canalele din rute (youtubeChannelRoutes), deci help-ul trebuie sa le mentioneze, nu doar canalul principal");
  assert.match(entry!.description, /principal/i, "mentioneaza si canalul principal");
});

test("command help catalog: descrierea /youtube videos show reflecta ca afisarea manuala revendica (claim) videoclipurile, nu ca nu modifica deduplicarea (R21 #4)", () => {
  const entry = COMMAND_HELP_ENTRIES.find(e => e.command === "/youtube videos show");
  assert.ok(entry, "exista un entry pentru /youtube videos show");
  assert.doesNotMatch(entry!.description, /nu modifica deduplicarea/i, "textul vechi contrazicea codul: afisarea manuala revendica videoclipurile");
  assert.match(entry!.description, /revendica|claim/i, "mentioneaza ca revendica (claim) videoclipurile postate");
  assert.match(entry!.description, /repeta:true/, "mentioneaza optiunea repeta:true pentru repostare");
});
