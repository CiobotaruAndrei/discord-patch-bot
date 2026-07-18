import test from "node:test";
import assert from "node:assert/strict";

import {
  formatAccessList,
  formatCurrentAccess,
  formatScopedAccess,
  labelMode,
  normalizeMode,
  type GuildAdminAccessDoc
} from "../../features/command-handlers/adminCommandAccessViews.js";

test("labelMode: role-or-higher vs restul", () => {
  assert.equal(labelMode("role-or-higher"), "rol sau rol mai mare");
  assert.equal(labelMode("role"), "rol exact");
  assert.equal(labelMode(null), "rol exact");
  assert.equal(labelMode(undefined), "rol exact");
});

test("normalizeMode: aliasuri + valori invalide", () => {
  assert.equal(normalizeMode("role"), "role");
  assert.equal(normalizeMode("role-or-higher"), "role-or-higher");
  assert.equal(normalizeMode("exact"), "role");
  assert.equal(normalizeMode("or-higher"), "role-or-higher");
  assert.equal(normalizeMode("altceva"), null);
  assert.equal(normalizeMode(null), null);
});

test("formatCurrentAccess: implicit cand nu exista regula", () => {
  const text = formatCurrentAccess("global", null);
  assert.match(text, /toate comenzile admin/);
  assert.match(text, /implicit/);
});

test("formatCurrentAccess: rol + mod + audit", () => {
  const text = formatCurrentAccess("global", {
    mode: "role-or-higher",
    roleId: "123",
    updatedBy: "456",
    updatedAt: "2024-01-01"
  });
  assert.match(text, /rol sau rol mai mare/);
  assert.match(text, /<@&123>/);
  assert.match(text, /<@456>/);
  assert.match(text, /2024-01-01/);
});

test("formatAccessList: linia globala implicita + o regula scoped", () => {
  const doc: GuildAdminAccessDoc = {
    adminCommandAccess: null,
    adminCommandAccessByCommand: { latest: { mode: "role", roleId: "9" } }
  };
  const text = formatAccessList(doc);
  assert.match(text, /toate comenzile admin: implicit/);
  assert.match(text, /\/latest/);
  assert.match(text, /<@&9>/);
});

test("formatAccessList: afiseaza catalogul CANONIC complet de comenzi admin - dedicat vs fallback global (audit, #7)", () => {
  const doc: GuildAdminAccessDoc = {
    adminCommandAccess: null,
    adminCommandAccessByCommand: { timeout: { mode: "role-or-higher", roleId: "42" } }
  };
  const text = formatAccessList(doc);
  assert.match(text, /Catalog complet de comenzi admin/);
  assert.match(text, /\/timeout/);
  assert.match(text, /<@&42>/);
  const fallbackCount = Number(text.match(/fallback-ul global \((\d+)\)/)?.[1] ?? "0");
  assert.ok(fallbackCount >= 5, `catalogul canonic enumereaza multe comenzi admin fara regula dedicata (a gasit ${fallbackCount})`);
});

test("formatAccessList: avertisment pentru reguli in conflict (start/stop cu roluri diferite)", () => {
  const doc: GuildAdminAccessDoc = {
    adminCommandAccessByCommand: {
      "start:latest": { mode: "role", roleId: "1" },
      "stop:latest": { mode: "role", roleId: "2" }
    }
  };
  const text = formatAccessList(doc);
  assert.match(text, /Reguli in conflict/);
  assert.match(text, /start:latest/);
  assert.match(text, /stop:latest/);
});

test("formatScopedAccess: regula exacta pentru scope", () => {
  const doc: GuildAdminAccessDoc = {
    adminCommandAccessByCommand: { latest: { mode: "role-or-higher", roleId: "7" } }
  };
  const text = formatScopedAccess(doc, "latest");
  assert.match(text, /\/latest/);
  assert.match(text, /rol sau rol mai mare/);
  assert.match(text, /<@&7>/);
});

test("formatScopedAccess: fara regula dedicata -> fallback global", () => {
  const doc: GuildAdminAccessDoc = {
    adminCommandAccess: { mode: "role", roleId: "5" },
    adminCommandAccessByCommand: {}
  };
  const text = formatScopedAccess(doc, "latest");
  assert.match(text, /fallback-ul global/);
  assert.match(text, /<@&5>/);
});

test("formatScopedAccess: nici regula, nici fallback -> implicit", () => {
  const text = formatScopedAccess({}, "latest");
  assert.match(text, /implicit/);
});
