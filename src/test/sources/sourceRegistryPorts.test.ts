import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { SOURCE_PORT_NAMES } from "../../sources/sourceRegistryPorts.js";
import { createSourcePorts } from "../../sources/sourcePortAdapters.js";

const srcRoot = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, relative), "utf8");
}

function asRegistry(stub: Record<string, unknown>): Record<string, unknown> & Parameters<typeof createSourcePorts>[0] {
  return stub as Record<string, unknown> & Parameters<typeof createSourcePorts>[0];
}

test("porturile de surse sunt interfete independente de registrul concret", () => {
  const ports = read("sources/sourceRegistryPorts.ts");
  assert.ok(
    !ports.includes("SourceRegistryApi") && !ports.includes("sourceRegistryFactory.js"),
    "portul nu se mai taie din API-ul concret al registrului"
  );
  assert.ok(!/Pick</.test(ports));
  for (const name of SOURCE_PORT_NAMES) {
    assert.match(ports, new RegExp(`^export interface ${name} \\{`, "m"), `${name} e declarat ca interfata proprie`);
  }
});

test("adaptorul traduce numele registrului in operatiile portului", async () => {
  const calls: string[] = [];
  const ports = createSourcePorts(asRegistry({
    httpReq: async (method: string, url: string) => { calls.push(`${method} ${url}`); return { data: null }; },
    MAX_HTML_BYTES: 111,
    MAX_JSON_BYTES: 222,
    FETCH_CONCURRENCY: 3,
    fetchSteamCurrentPlayers: async (appId: string | number) => { calls.push(`players:${appId}`); return null; },
    extractOfferEndFromHtml: () => "2026-01-01",
    stableUpdateId: (title: string, link: string) => `${title}|${link}`,
    MAX_DEALS: 50,
    cleanEnrichedCache: () => { calls.push("sweep"); },
    getEnrichedCacheSize: () => 9
  }));

  await ports.http.request("GET", "https://example.test");
  assert.equal(ports.http.maxHtmlBytes(), 111);
  assert.equal(ports.http.maxJsonBytes(), 222);
  assert.equal(ports.http.fetchConcurrency(), 3);
  await ports.steam.currentPlayers("730");
  assert.equal(ports.steam.offerEndFromHtml("<html>"), "2026-01-01");
  assert.equal(ports.updates.stableUpdateId("t", "l"), "t|l");
  assert.equal(ports.deals.maxDeals(), 50);
  ports.deals.sweepEnrichedCache();
  assert.equal(ports.deals.enrichedCacheSize(), 9);

  assert.deepEqual(calls, ["GET https://example.test", "players:730", "sweep"]);
});

test("portul de oferte are un consumator real in curatarea periodica", () => {
  const housekeeping = read("app/scheduler/housekeeping.ts");
  assert.match(housekeeping, /DealsSourcePort/);
});

test("lista de porturi si interfetele exportate raman aliniate", () => {
  const ports = read("sources/sourceRegistryPorts.ts");
  const exported = [...ports.matchAll(/^export interface (\w+Port) \{/gm)].map(match => match[1]).sort();
  assert.deepEqual(exported, [...SOURCE_PORT_NAMES].sort());
});
