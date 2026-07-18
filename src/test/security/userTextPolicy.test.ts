import test from "node:test";
import assert from "node:assert/strict";

import {
  USER_TEXT_FIELD_POLICIES,
  containsExternalLink,
  validateUserText
} from "../../features/command-security/userTextPolicy.js";

test("catalogul central declara toate campurile text auditate", () => {
  for (const field of [
    "moderation.reason",
    "report.bug.description",
    "report.complaint.reason",
    "suggest-command.name",
    "suggest-command.description",
    "game-alias.alias",
    "template.text",
    "youtube.message-template",
    "youtube.channel-reference",
    "moderation.attachment"
  ]) assert.ok(field in USER_TEXT_FIELD_POLICIES, `${field} are politica declarata`);
});

test("validatorul refuza scheme, www, domenii si invitatii, dar accepta text si emoji", () => {
  for (const value of [
    "https://evil.example/path",
    "ftp://evil.example/file",
    "www.evil.example",
    "evil.example/path",
    "discord.gg/invite"
  ]) assert.throws(() => validateUserText("suggest-command.name", value));
  assert.equal(
    validateUserText("suggest-command.description", "Comanda utila \u{1F3AE} fara link"),
    "Comanda utila \u{1F3AE} fara link",
  );
  assert.equal(containsExternalLink("text normal"), false);
});

test("campul URL explicit ramane acceptat", () => {
  assert.equal(validateUserText("youtube.channel-reference", "https://youtube.com/@canal"), "https://youtube.com/@canal");
});
