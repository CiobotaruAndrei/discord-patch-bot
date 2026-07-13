import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";
import { decideAdminAccess, decideSensitiveAccess, isSensitiveUserAllowed } from "../../features/command-security/adminAccessPolicy.js";
import type { AdminAccessPolicyFacts } from "../../features/command-security/adminAccessPolicy.js";

function facts(overrides: Partial<AdminAccessPolicyFacts> = {}): AdminAccessPolicyFacts {
  return {
    inGuild: true,
    ownerOnlyCommand: false,
    isGuildOwner: false,
    isDiscordAdmin: false,
    configuredRoleMatches: false,
    ...overrides
  };
}

test("policy: in afara guild-ului refuza inainte de orice alta regula, chiar pentru admin/owner", () => {
  assert.deepEqual(decideAdminAccess(facts({ inGuild: false, isDiscordAdmin: true })), { outcome: "deny-outside-guild" });
  assert.deepEqual(decideAdminAccess(facts({ inGuild: false, ownerOnlyCommand: true, isGuildOwner: true })), { outcome: "deny-outside-guild" });
});

test("policy: owner-ul serverului trece pe comenzile owner-only inaintea verificarii de Administrator", () => {
  assert.deepEqual(
    decideAdminAccess(facts({ ownerOnlyCommand: true, isGuildOwner: true })),
    { outcome: "allow", grantedBy: "guild-owner" }
  );
});

test("policy: owner-ul NU primeste acces prin simplul fapt ca e owner pe comenzi care nu sunt owner-only", () => {
  assert.deepEqual(decideAdminAccess(facts({ isGuildOwner: true })), { outcome: "needs-global-code" });
});

test("policy: Administrator Discord trece; regula de rol configurata trece; altfel se cere codul global", () => {
  assert.deepEqual(decideAdminAccess(facts({ isDiscordAdmin: true })), { outcome: "allow", grantedBy: "discord-admin" });
  assert.deepEqual(decideAdminAccess(facts({ configuredRoleMatches: true })), { outcome: "allow", grantedBy: "configured-role" });
  assert.deepEqual(decideAdminAccess(facts()), { outcome: "needs-global-code" });
});

test("policy: precedenta grant-urilor este owner > discord-admin > configured-role", () => {
  assert.equal(
    decideAdminAccess(facts({ ownerOnlyCommand: true, isGuildOwner: true, isDiscordAdmin: true, configuredRoleMatches: true })).outcome === "allow"
      && (decideAdminAccess(facts({ ownerOnlyCommand: true, isGuildOwner: true, isDiscordAdmin: true })) as { grantedBy: string }).grantedBy,
    "guild-owner"
  );
  assert.deepEqual(
    decideAdminAccess(facts({ isDiscordAdmin: true, configuredRoleMatches: true })),
    { outcome: "allow", grantedBy: "discord-admin" }
  );
});

test("policy sensitive: allowlist gol permite pe oricine; comanda ne-sensibila nu blocheaza niciodata", () => {
  assert.equal(isSensitiveUserAllowed([], "oricine"), true);
  assert.deepEqual(decideSensitiveAccess({ sensitiveCommand: false, allowlist: ["op-1"], userId: "altcineva" }), { blocked: false });
});

test("policy sensitive: cu allowlist configurat, doar userii din lista trec pe comenzile sensibile", () => {
  assert.deepEqual(decideSensitiveAccess({ sensitiveCommand: true, allowlist: ["op-1"], userId: "op-1" }), { blocked: false });
  assert.deepEqual(decideSensitiveAccess({ sensitiveCommand: true, allowlist: ["op-1"], userId: "altcineva" }), { blocked: true });
  assert.deepEqual(decideSensitiveAccess({ sensitiveCommand: true, allowlist: ["op-1"], userId: "" }), { blocked: true });
});

test("policy: modulul e pur — fara dependinte de discord.js sau de interaction", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const source = fs.readFileSync(path.join(process.cwd(), "features", "command-security", "adminAccessPolicy.ts"), "utf8");
  assert.ok(!source.includes("discord.js"), "fara import discord.js");
  assert.ok(!/[Ii]nteraction/.test(source), "fara tipuri de interaction — motorul primeste doar fapte");
  assert.ok(!source.includes("require("), "fara require-uri runtime — modul pur de decizie");
});
