import test from "node:test";
import assert from "node:assert/strict";

import { calls, loadModule, topLevelMembersOf } from "./sourceStructureQueries.js";

const gateway = loadModule("app", "runtime", "gatewayFeatureRuntimes.ts");
const appRuntime = loadModule("app", "appRuntime.ts");

function gatewayRuntimeNames(): string[] {
  return topLevelMembersOf(gateway, "GatewayFeatureRuntimes").map(member => member.name);
}

function forwardedNames(): string[] {
  const registration = calls(appRuntime).find(call => call.callee === "registerDiscordEvents");
  assert.ok(registration, "registerDiscordEvents nu mai este apelat din appRuntime");
  const argument = registration.args[0] ?? "";
  return [...argument.matchAll(/(\w+)\s*:\s*gateway\.(\w+)/g)].map(match => match[2]);
}

test("fiecare runtime produs de gateway ajunge la registerDiscordEvents", () => {
  const produced = gatewayRuntimeNames();
  assert.ok(produced.length >= 6, `nu am gasit runtime-urile in GatewayFeatureRuntimes (${produced.length})`);

  const forwarded = new Set(forwardedNames());
  const missing = produced.filter(name => !forwarded.has(name));

  assert.deepEqual(
    missing,
    [],
    "un runtime returnat de gateway dar netransmis la registerDiscordEvents este mereu undefined in productie: "
      + "codul exista, testele lui trec, si protectia nu ruleaza niciodata"
  );
});

test("niciun runtime transmis nu e inventat pe langa cele produse de gateway", () => {
  const produced = new Set(gatewayRuntimeNames());
  const extra = forwardedNames().filter(name => !produced.has(name));

  assert.deepEqual(extra, [], "appRuntime citeste de pe gateway un camp care nu exista in GatewayFeatureRuntimes");
});
