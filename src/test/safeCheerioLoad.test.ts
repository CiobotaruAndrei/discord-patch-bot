
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

import test from "node:test";
import assert from "node:assert/strict";
import { safeCheerioLoad, MAX_HTML_BYTES } from "../sources/sourceRegistry";

test("nu sparge codepoint-uri UTF-8 la limita maxima", () => {
  const filler = "<p>x</p>".repeat(Math.floor(MAX_HTML_BYTES / 8) - 10);
  const emoji = "\ud83c\udfae";
  const html = `<html><body>${filler}${emoji.repeat(50)}</body></html>`;

  const $ = safeCheerioLoad(html);
  const bodyText = $("body").text();

  let valid = true;
  for (let i = 0; i < bodyText.length; i++) {
    const code = bodyText.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = bodyText.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) { valid = false; break; }
      i++;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      valid = false;
      break;
    }
  }
  assert.ok(valid, "Textul rezultat trebuie sa fie UTF-16 valid");
});

test("accepta input mic fara modificari", () => {
  const html = "<html><body><p>Salut \ud83c\udfae Romania</p></body></html>";
  const $ = safeCheerioLoad(html);
  assert.equal($("p").text(), "Salut \ud83c\udfae Romania");
});

test("accepta input gol", () => {
  const $ = safeCheerioLoad("");
  assert.equal($("body").text(), "");
});

test("accepta input non-string", () => {
  const $ = safeCheerioLoad(null);
  assert.equal($("body").text(), "");
});

test("conversie din number la string", () => {
  const $ = safeCheerioLoad(42);
  assert.equal($("body").text(), "42");
});

export {};
