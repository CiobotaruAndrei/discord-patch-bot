import attachSlashCommands from "../../features/command-definitions/slashCommandDefinitions.js";
import { moduleContext } from "../moduleContextStub.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMAND_ACCESS_MANIFEST,
  isOwnerOnlyCommandPath,
  isRouterAdminCommandPath,
  isRuntimeAdminCommandPath,
  isSensitiveCommandPath
} from "../../features/command-security/commandAccessManifest.js";
import { COMMAND_HELP_ENTRIES } from "../../features/command-help/commandHelpCatalog.js";

import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

function slashTopLevelCommands(): Array<{ name: string; hasDiscordPerms: boolean }> {
  const target: Record<string, unknown> = {
    SlashCommandBuilder,
    PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    env: {}
  };
  attachSlashCommands(moduleContext<Parameters<typeof attachSlashCommands>[0]>(target));
  const defs = (target.buildSlashCommandDefinitions as () => Array<{ name: string; default_member_permissions?: string | number | null }>)();
  return defs.map(def => ({ name: def.name, hasDiscordPerms: def.default_member_permissions != null }));
}

function pathParts(command: string): { name: string; group: string; sub: string } {
  const tokens = command.replace(/^\//, "").split(/\s+/).filter(Boolean);
  return {
    name: tokens[0] || "",
    group: tokens.length >= 3 ? tokens[1] || "" : "",
    sub: tokens.length >= 3 ? tokens[2] || "" : tokens[1] || ""
  };
}

test("manifest: acopera BIDIRECTIONAL toate comenzile top-level din slash definitions, fara duplicate (single source of truth)", () => {
  const slashNames = new Set(slashTopLevelCommands().map(cmd => cmd.name));
  const manifestNames = new Set(COMMAND_ACCESS_MANIFEST.map(rule => rule.command));
  for (const name of slashNames) {
    assert.ok(manifestNames.has(name), `comanda slash /${name} nu e declarata in commandAccessManifest`);
  }
  for (const name of manifestNames) {
    assert.ok(slashNames.has(name), `manifestul declara o comanda inexistenta (stale): ${name}`);
  }
  assert.equal(manifestNames.size, COMMAND_ACCESS_MANIFEST.length, "manifestul nu are comenzi duplicate");
});

test("manifest: discordAdminPermissions coincide cu setDefaultMemberPermissions din slash definitions pentru fiecare comanda", () => {
  const byName = new Map(slashTopLevelCommands().map(cmd => [cmd.name, cmd.hasDiscordPerms]));
  for (const rule of COMMAND_ACCESS_MANIFEST) {
    assert.equal(
      rule.discordAdminPermissions,
      byName.get(rule.command),
      `/${rule.command}: manifestul declara discordAdminPermissions=${rule.discordAdminPermissions}, slash definitions au ${byName.get(rule.command)}`
    );
  }
});

test("manifest: clasificarea Public/Admin/owner-only din help catalog coincide cu derivarea din manifest (anti-drift)", () => {
  for (const entry of COMMAND_HELP_ENTRIES) {
    const { name, group, sub } = pathParts(entry.command);
    const ownerExpected = entry.permissions.includes("owner-only");
    const adminExpected = entry.permissions.startsWith("Admin");
    const owner = isOwnerOnlyCommandPath(name, sub);
    const router = isRouterAdminCommandPath(name, sub, group);
    const runtime = isRuntimeAdminCommandPath(name, sub, group);
    assert.equal(owner, ownerExpected, `${entry.command}: catalogul declara owner-only=${ownerExpected}, manifestul deriva ${owner}`);
    assert.equal(
      router || runtime || owner,
      adminExpected,
      `${entry.command}: catalogul declara "${entry.permissions}" dar manifestul deriva admin=${router || runtime || owner} (router=${router}, runtime=${runtime}, owner=${owner})`
    );
  }
});

test("manifest: derivarile sensitive si owner-only pastreaza exact comportamentul fostelor liste manuale din guard (R[#4])", () => {
  assert.equal(isSensitiveCommandPath("reset-config", ""), true, "reset-config e sensibil indiferent de subcomanda");
  assert.equal(isSensitiveCommandPath("backup", "load"), true);
  assert.equal(isSensitiveCommandPath("backup", "delete"), true);
  assert.equal(isSensitiveCommandPath("backup", "list"), false);
  assert.equal(isOwnerOnlyCommandPath("admin-command-access", "list"), true);
  assert.equal(isOwnerOnlyCommandPath("set", "admin-command-access"), true);
  assert.equal(isOwnerOnlyCommandPath("delete", "admin-command-access"), true);
  assert.equal(isOwnerOnlyCommandPath("set", "mode"), false);
  assert.equal(isRouterAdminCommandPath("add", "suggestion"), false, "/add suggestion ramane public");
  assert.equal(isRouterAdminCommandPath("add", "backup"), true);
  assert.equal(isRouterAdminCommandPath("remove", "price-alert"), true);
  assert.equal(isRouterAdminCommandPath("report", "bugs", "list"), true, "/report list bugs trece prin guard-ul central");
  assert.equal(isRuntimeAdminCommandPath("report", "bugs", "list"), true);
  assert.equal(isRouterAdminCommandPath("report", "bug"), false, "/report bug ramane public");
  assert.equal(isRuntimeAdminCommandPath("watchlist-game", "delete"), true);
  assert.equal(isRuntimeAdminCommandPath("watchlist-game", "add"), false);
});

import fs from "fs";
import path from "path";

function docsCommandRows(): Array<{ command: string; permissions: string | null }> {
  const doc = fs.readFileSync(path.join(process.cwd(), "..", "docs", "Comenzi Functionalitate.md"), "utf8");
  const rows: Array<{ command: string; permissions: string | null }> = [];
  for (const line of doc.split("\n")) {
    const match = /^\|\s*`(\/[^`]+)`\s*\|([^|]*)\|/.exec(line);
    if (!match) continue;
    const cells = line.split("|").filter(cell => cell.trim().length > 0);
    rows.push({ command: match[1], permissions: cells.length >= 3 ? match[2].trim() : null });
  }
  return rows;
}

function normalizeDocCommandPath(command: string): { name: string; group: string; sub: string } {
  const cleaned = command.replace(/\s+[a-z-]+:.*$/, "").replace(/\s+<.*$/, "").trim();
  return pathParts(cleaned);
}

test("coloana Permisiuni din docs/Comenzi Functionalitate.md coincide cu manifestul de acces (finalizare #13: docs verificate din manifest)", () => {
  const rows = docsCommandRows();
  assert.ok(rows.length > 40, "tabelele de comenzi au fost parsate");
  for (const row of rows) {
    const { name, group, sub } = normalizeDocCommandPath(row.command);
    const owner = isOwnerOnlyCommandPath(name, sub);
    const router = isRouterAdminCommandPath(name, sub, group);
    const runtime = isRuntimeAdminCommandPath(name, sub, group);
    const derivedAdmin = owner || router || runtime;
    if (row.permissions === null) {
      assert.equal(derivedAdmin, false, `${row.command}: apare intr-un tabel fara coloana de permisiuni (public), dar manifestul o deriva ca admin`);
      continue;
    }
    const docsSaysOwner = /owner-only/i.test(row.permissions);
    const docsSaysAdmin = /admin/i.test(row.permissions) || docsSaysOwner;
    assert.equal(docsSaysOwner, owner, `${row.command}: docs declara "${row.permissions}", manifestul deriva owner-only=${owner}`);
    assert.equal(docsSaysAdmin, derivedAdmin, `${row.command}: docs declara "${row.permissions}", manifestul deriva admin=${derivedAdmin} (router=${router}, runtime=${runtime}, owner=${owner})`);
  }
});
