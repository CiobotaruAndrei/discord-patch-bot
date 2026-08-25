import test from "node:test";
import assert from "node:assert/strict";

import { PROTECTION_CHANNEL_FIELDS, resolveProtectionChannel } from "../../features/command-security/securityChannelResolution.js";
import { START_STOP_TOGGLE_FIELDS } from "../../features/command-security/securityCommandFields.js";
import { calls, loadModule } from "./sourceStructureQueries.js";

const RESOLVER = "resolveProtectionChannel";

test("fiecare protectie cu start/stop are o regula de canal declarata (F-43)", () => {
  for (const key of Object.keys(START_STOP_TOGGLE_FIELDS)) {
    assert.ok(
      PROTECTION_CHANNEL_FIELDS[key],
      `${key} nu are regula de canal, deci fiecare consumator si-ar inventa una`
    );
  }
});

test("campul principal al fiecarei protectii e cel din definitia comenzii (F-43)", () => {
  for (const [key, toggle] of Object.entries(START_STOP_TOGGLE_FIELDS)) {
    const fields = PROTECTION_CHANNEL_FIELDS[key] ?? [];
    assert.equal(
      fields[0],
      toggle.channel,
      `${key}: /set scrie in ${toggle.channel}, deci rezolvarea trebuie sa il citeasca primul`
    );
  }
});

test("cele trei cai care aleg canalul folosesc aceeasi sursa de adevar (F-43)", () => {
  const consumers = [
    ["features", "command-security", "securityStatusModel.ts"],
    ["features", "command-handlers", "securityInteractionHandler.ts"],
    ["app", "runtime", "antiRaidGuildAdapter.ts"]
  ] as const;

  const without = consumers
    .filter(path => !calls(loadModule(...path)).some(call => call.callee === RESOLVER))
    .map(path => path.join("/"));

  assert.deepEqual(
    without,
    [],
    "start, runtime si /security-status trebuie sa citeasca acelasi rezolvator; asa a aparut cazul in care anti-raid "
      + "aparea incomplet in status desi runtime-ul avea canal functional"
  );
});

test("fallback-ul pe canalul de cereri exista doar unde runtime-ul chiar il accepta (F-43)", () => {
  const withFallback = Object.entries(PROTECTION_CHANNEL_FIELDS)
    .filter(([, fields]) => fields.length > 1)
    .map(([key]) => key)
    .sort();

  assert.deepEqual(
    withFallback,
    ["anti-raid", "anti-raid-dry-run"],
    "un fallback declarat pentru o protectie care nu il implementeaza ar arata pregatita una care nu poate publica nimic"
  );
});

test("anti-raid ramane pregatit cu canalul de cereri, fara unul dedicat (F-43)", () => {
  const settings = { permissionRequestChannelId: "chan-cereri" };

  assert.equal(resolveProtectionChannel("anti-raid", settings), "chan-cereri");
  assert.equal(resolveProtectionChannel("ad-protection", settings), null, "fallback-ul nu se aplica altor protectii");
});

test("canalul dedicat are prioritate fata de cel de cereri (F-43)", () => {
  const settings = { antiRaidAlertChannelId: "chan-raid", permissionRequestChannelId: "chan-cereri" };

  assert.equal(resolveProtectionChannel("anti-raid", settings), "chan-raid");
});
