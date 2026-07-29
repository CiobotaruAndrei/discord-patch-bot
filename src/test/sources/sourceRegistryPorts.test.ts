import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import { SOURCE_PORT_NAMES } from "../../sources/sourceRegistryPorts.js";
import type { DealsSourcePort, HttpSourcePort, SteamSourcePort, UpdatesSourcePort } from "../../sources/sourceRegistryPorts.js";
import type { SourceRegistryApi } from "../../sources/sourceRegistryFactory.js";

type IsStrictSubset<Port> = keyof Port extends keyof SourceRegistryApi
  ? keyof SourceRegistryApi extends keyof Port ? false : true
  : false;

const httpIsSubset: IsStrictSubset<HttpSourcePort> extends true ? true : never = true;
const steamIsSubset: IsStrictSubset<SteamSourcePort> extends true ? true : never = true;
const updatesIsSubset: IsStrictSubset<UpdatesSourcePort> extends true ? true : never = true;
const dealsIsSubset: IsStrictSubset<DealsSourcePort> extends true ? true : never = true;

test("fiecare port de sursa e un subset strict al registrului, verificat de compilator", () => {
  for (const [nume, verificat] of [
    ["HttpSourcePort", httpIsSubset],
    ["SteamSourcePort", steamIsSubset],
    ["UpdatesSourcePort", updatesIsSubset],
    ["DealsSourcePort", dealsIsSubset]
  ] as const) {
    assert.equal(verificat, true, `${nume} trebuie sa fie mai ingust decat registrul intreg, altfel nu separa nimic`);
  }
});

test("porturile se taie din registru, nu se redeclara", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "sources", "sourceRegistryPorts.ts"), "utf8");
  assert.match(
    text,
    /type Port<K extends keyof SourceRegistryApi> = Pick<SourceRegistryApi, K>;/,
    "o functie redenumita in registru trebuie sa rupa portul la compilare; redeclarate de mana, cele doua ar putea devia"
  );
  assert.ok(!text.includes("=> "), "porturile nu isi descriu propriile semnaturi; doar selecteaza din contractul existent");
});

test("un consumator de deals nu vede functiile de update si invers", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "sources", "sourceRegistryPorts.ts"), "utf8");
  const deals = text.slice(text.indexOf("export type DealsSourcePort"));
  const updates = text.slice(text.indexOf("export type UpdatesSourcePort"), text.indexOf("export type DealsSourcePort"));

  assert.ok(!deals.includes("fetchGameUpdate"), "domeniul de reduceri nu are ce cauta in fetch-ul de update-uri");
  assert.ok(!updates.includes("fetchDeals"), "domeniul de update-uri nu are ce cauta in fetch-ul de reduceri");
});

test("lista de porturi ramane aliniata cu tipurile exportate", () => {
  const text = fs.readFileSync(path.join(process.cwd(), "sources", "sourceRegistryPorts.ts"), "utf8");
  const exportate = [...text.matchAll(/^export type (\w+Port) =/gm)].map(match => match[1]).sort();
  assert.deepEqual(exportate, [...SOURCE_PORT_NAMES].sort(), "un port nou trebuie trecut si in lista");
});
