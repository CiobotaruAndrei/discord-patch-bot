import test from "node:test";
import assert from "node:assert/strict";

import commandCache from "../../features/command-cache/commandCache.js";
const { computeMissingChannelPerms, formatMissingChannelPerms } = commandCache;

const PermissionsBitField = { Flags: { ViewChannel: "VIEW", SendMessages: "SEND", EmbedLinks: "EMBED" } };

function makeChannel(granted: Set<string> | null, opts: { textBased?: boolean } = {}) {
  return {
    isTextBased: () => opts.textBased !== false,
    permissionsFor: (_botId: string) => granted === null ? null : { has: (flag: unknown) => granted.has(flag as string) }
  };
}

test("computeMissingChannelPerms: canal null/undefined => null (nu putem rezolva)", () => {
  assert.equal(computeMissingChannelPerms(null, "bot", PermissionsBitField), null);
  assert.equal(computeMissingChannelPerms(undefined, "bot", PermissionsBitField), null);
});

test("computeMissingChannelPerms: canal non-text => null", () => {
  assert.equal(computeMissingChannelPerms(makeChannel(new Set(), { textBased: false }), "bot", PermissionsBitField), null);
});

test("computeMissingChannelPerms: permissionsFor intoarce null => null (fail-closed la apelant)", () => {
  assert.equal(computeMissingChannelPerms(makeChannel(null), "bot", PermissionsBitField), null);
});

test("computeMissingChannelPerms: toate permisiunile prezente => lista goala", () => {
  const channel = makeChannel(new Set(["VIEW", "SEND", "EMBED"]));
  assert.deepEqual(computeMissingChannelPerms(channel, "bot", PermissionsBitField), []);
});

test("computeMissingChannelPerms: lipseste doar Embed Links => raporteaza exact aceea", () => {
  const channel = makeChannel(new Set(["VIEW", "SEND"]));
  assert.deepEqual(computeMissingChannelPerms(channel, "bot", PermissionsBitField), ["Embed Links"]);
});

test("computeMissingChannelPerms: lipsesc toate => le listeaza pe toate, in ordine", () => {
  const channel = makeChannel(new Set());
  assert.deepEqual(computeMissingChannelPerms(channel, "bot", PermissionsBitField), ["View Channel", "Send Messages", "Embed Links"]);
});

test("formatMissingChannelPerms: lista nevida => mesaj precis cu permisiunile lipsa", () => {
  const msg = formatMissingChannelPerms(["Send Messages", "Embed Links"]);
  assert.match(msg, /Lipsesc permisiunile/);
  assert.match(msg, /\*\*Send Messages\*\*/);
  assert.match(msg, /\*\*Embed Links\*\*/);
});

test("formatMissingChannelPerms: lista goala/undefined => mesaj generic cu cele trei permisiuni", () => {
  for (const value of [[], null, undefined] as Array<string[] | null | undefined>) {
    const msg = formatMissingChannelPerms(value);
    assert.match(msg, /View Channel/);
    assert.match(msg, /Send Messages/);
    assert.match(msg, /Embed Links/);
  }
});
