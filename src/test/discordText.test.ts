import test from "node:test";
import assert from "node:assert/strict";

import { escapeInlineText, NO_MENTIONS } from "../shared/discordText.js";

test("escapeInlineText neutralizeaza backtick-uri, mentiuni si newline-uri (R[P3] suggest-command)", () => {
  const escaped = escapeInlineText("`code` **bold**\n@everyone <@123> <#456>");
  assert.doesNotMatch(escaped, /\n/, "newline-urile sunt colapsate");
  assert.ok(escaped.includes("\\`"), "backtick-urile sunt escapate, nu pot inchide un bloc de cod");
  assert.ok(escaped.includes("\\*"), "asteriscurile (bold) sunt escapate");
  assert.ok(escaped.includes("\\@"), "@everyone/@here nu mai pot fi mentiuni text");
  assert.ok(escaped.includes("\\<"), "sintaxa de mentiune <@id> e neutralizata vizual");
});

test("escapeInlineText taie la lungimea maxima si trateaza non-stringuri", () => {
  assert.equal(escapeInlineText("abcdef", 3), "abc");
  assert.equal(escapeInlineText(null), "");
  assert.equal(escapeInlineText(undefined), "");
});

test("NO_MENTIONS dezactiveaza orice ping (parse gol)", () => {
  assert.deepEqual(NO_MENTIONS, { parse: [] });
});
