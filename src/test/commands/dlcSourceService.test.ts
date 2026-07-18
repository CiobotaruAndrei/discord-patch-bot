import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import { fetchGameDlcs, normalizeDlcKey } from "../../features/command-handlers/dlcSourceService.js";

function deps(html: string, opts?: { throwOnFetch?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    httpReq: async (_method: string, url: string) => {
      calls.push(url);
      if (opts?.throwOnFetch) throw new Error("network down");
      return { data: html };
    },
    safeCheerioLoad: (input: unknown) => cheerio.load(String(input)),
    logger: () => undefined
  };
}

test("normalizeDlcKey: appId numeric stabil are prioritate; altfel cheie derivata din nume (audit, #12)", () => {
  assert.equal(normalizeDlcKey("730", "Orice"), "730");
  assert.equal(normalizeDlcKey("", "  DLC   Alpha "), "name:dlc alpha");
  assert.equal(normalizeDlcKey(null, "Beta"), "name:beta");
});

test("fetchGameDlcs: pagina cu DLC-uri => ok cu dlcKey stabil (audit, #12)", async () => {
  const html = `
    <div class="game_area_purchase_game"></div>
    <div class="game_area_dlc_row" data-ds-appid="111"><div class="game_area_dlc_name">DLC Unu</div><div class="game_area_dlc_price">$5</div></div>
    <div class="game_area_dlc_row" data-ds-appid="222"><div class="game_area_dlc_name">DLC Doi</div><div class="game_area_dlc_price">$7</div></div>`;
  const d = deps(html);
  const outcome = await fetchGameDlcs(d, 730, "ro");
  assert.equal(outcome.status, "ok");
  assert.deepEqual(outcome.status === "ok" ? outcome.dlcs : null, [
    { dlcKey: "111", name: "DLC Unu", price: "$5" },
    { dlcKey: "222", name: "DLC Doi", price: "$7" }
  ]);
  assert.match(d.calls[0], /store\.steampowered\.com\/app\/730\?cc=ro/);
});

test("fetchGameDlcs: age-gate, parse-error si pagina fara DLC sunt distinse (audit, #12)", async () => {
  assert.equal((await fetchGameDlcs(deps('<div id="agegate_box"></div>'), 1)).status, "age-gate");
  assert.equal((await fetchGameDlcs(deps("<div>necunoscut</div>"), 1)).status, "parse-error");
  const noDlc = await fetchGameDlcs(deps('<div class="game_area_purchase_game"></div>'), 1);
  assert.equal(noDlc.status, "ok");
  assert.deepEqual(noDlc.status === "ok" ? noDlc.dlcs : null, [], "pagina de magazin fara DLC => lista goala, nu eroare");
});

test("fetchGameDlcs: esec de retea => unavailable, fara aruncare (audit, #12)", async () => {
  const outcome = await fetchGameDlcs(deps("", { throwOnFetch: true }), 1);
  assert.equal(outcome.status, "unavailable");
});
