// @ts-check
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractOfferEndFromHtml } = require("../sources");

test("extrage din .game_purchase_discount_countdown - Offer ends", () => {
  const html = `<html><body>
    <div class="game_purchase_discount_countdown">Offer ends 30 Dec @ 10:00am</div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /30 Dec/);
});

test("extrage Sale ends", () => {
  const html = `<html><body>
    <div class="game_purchase_discount_countdown">Sale ends 15 Nov</div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /15 Nov/);
});

test("extrage Special promotion ends", () => {
  const html = `<html><body>
    <div class="game_purchase_discount_countdown">Special promotion ends 1 Jan</div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /1 Jan/);
});

test("extrage Daily Deal Offer ends", () => {
  const html = `<html><body>
    <div class="game_purchase_discount_countdown">Daily Deal! Offer ends 25 Oct @ 5:00pm</div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /25 Oct/);
});

test("fallback la body text daca lipseste container-ul", () => {
  const html = `<html><body>
    <span>random text</span>
    <span>Offer ends 12 Dec at noon</span>
    <span>more text</span>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /12 Dec/);
});

test("fallback regex direct pe raw HTML", () => {
  const html = `<div>Offer ends 5 Feb</div>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /5 Feb/);
});

test("returneaza null daca nimic nu match-uieste", () => {
  const html = `<html><body><p>Nothing here.</p></body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.equal(result, null);
});

test("limiteaza lungimea rezultatului fallback", () => {
  const html = `<html><body>Offer ends ${"X".repeat(500)}</body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.ok((result || "").length <= 200, "fallback trebuie limitat la 200 char");
});

export {};
