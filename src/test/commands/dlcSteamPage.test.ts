import test from "node:test";
import assert from "node:assert/strict";

import { dlcPageHasAgeGate, dlcPageLooksLikeStorePage, parseDlcRows } from "../../features/command-handlers/dlcSteamPage.js";

import * as cheerio from "cheerio";
const load = (html: string) => cheerio.load(html);

test("dlcPageHasAgeGate: detecteaza #agegate_box sau .agegate_text_container", () => {
  assert.equal(dlcPageHasAgeGate(load('<div id="agegate_box"></div>')), true);
  assert.equal(dlcPageHasAgeGate(load('<div class="agegate_text_container"></div>')), true);
  assert.equal(dlcPageHasAgeGate(load('<div class="game_area_purchase_game"></div>')), false);
});

test("parseDlcRows: extrage nume + pret din randurile DLC", () => {
  const html = `
    <div class="game_area_dlc_row" data-ds-appid="1">
      <div class="game_area_dlc_name">DLC Alpha</div>
      <div class="game_area_dlc_price">$9.99</div>
    </div>
    <div class="game_area_dlc_row" data-ds-appid="2">
      <div class="game_area_dlc_name">DLC Beta</div>
      <div class="game_area_dlc_price">  12,99  lei </div>
    </div>`;
  const rows = parseDlcRows(load(html));
  assert.deepEqual(rows, [
    { name: "DLC Alpha", price: "$9.99" },
    { name: "DLC Beta", price: "12,99 lei" }
  ]);
});

test("parseDlcRows: pret lipsa -> 'Pret indisponibil'", () => {
  const html = `
    <div class="game_area_dlc_row" data-ds-appid="7">
      <div class="game_area_dlc_name">DLC Gratis</div>
      <div class="game_area_dlc_price"></div>
    </div>`;
  const rows = parseDlcRows(load(html));
  assert.deepEqual(rows, [{ name: "DLC Gratis", price: "Pret indisponibil" }]);
});

test("parseDlcRows: deduplica dupa data-ds-appid si ignora randurile fara nume", () => {
  const html = `
    <div class="game_area_dlc_row" data-ds-appid="5">
      <div class="game_area_dlc_name">DLC Unic</div>
      <div class="game_area_dlc_price">$1</div>
    </div>
    <div class="game_area_dlc_row" data-ds-appid="5">
      <div class="game_area_dlc_name">DLC Unic (duplicat)</div>
      <div class="game_area_dlc_price">$1</div>
    </div>
    <div class="game_area_dlc_row" data-ds-appid="6">
      <div class="game_area_dlc_name"></div>
      <div class="game_area_dlc_price">$2</div>
    </div>`;
  const rows = parseDlcRows(load(html));
  assert.deepEqual(rows, [{ name: "DLC Unic", price: "$1" }]);
});

test("parseDlcRows: pagina fara randuri DLC -> lista goala", () => {
  assert.deepEqual(parseDlcRows(load("<div class=\"game_area_purchase_game\"></div>")), []);
});

test("dlcPageLooksLikeStorePage: detecteaza .game_area_purchase_game", () => {
  assert.equal(dlcPageLooksLikeStorePage(load('<div class="game_area_purchase_game"></div>')), true);
  assert.equal(dlcPageLooksLikeStorePage(load("<div>fara nimic</div>")), false);
});
