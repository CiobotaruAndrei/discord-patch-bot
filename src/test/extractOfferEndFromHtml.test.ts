// @ts-check
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractOfferEndFromHtml } = require("../sources/sourceRegistry");

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

test("fallback la text din .game_area_purchase daca lipseste countdown-ul", () => {
  const html = `<html><body>
    <div class="game_area_purchase">
      <span>Offer ends 12 Dec at noon</span>
    </div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /12 Dec/);
});

test("fallback la .game_purchase_action prinde data", () => {
  const html = `<html><body>
    <div class="game_purchase_action">Sale ends 30 Jan @ 7pm</div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.match(result || "", /30 Jan/);
});

test("nu prinde data dintr-un sidebar nelegat de produsul principal", () => {
  // V11 regression guard: sidebar-ul de la 'Customers also bought' sau
  // 'More like this' poate avea propriul 'Offer ends ...' pentru un alt joc.
  // Cand pagina principala NU are countdown/purchase area, nu mai cautam in tot
  // body-ul ca sa nu lipim data unui produs nelegat la embed.
  const html = `<html><body>
    <h1>Game without active sale</h1>
    <aside class="recommendation_widget">
      <a>Customers also bought</a>
      <span>Offer ends 99 Aug</span>
    </aside>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.equal(result, null, "n-ar trebui sa prindem '99 Aug' din sidebar");
});

test("returneaza null daca nimic nu match-uieste", () => {
  const html = `<html><body><p>Nothing here.</p></body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.equal(result, null);
});

test("limiteaza lungimea rezultatului fallback", () => {
  const html = `<html><body>
    <div class="game_area_purchase">Offer ends ${"X".repeat(500)}</div>
  </body></html>`;
  const result = extractOfferEndFromHtml(html);
  assert.ok((result || "").length <= 200, "fallback trebuie limitat la 200 char");
});

export {};
