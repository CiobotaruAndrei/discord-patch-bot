import test from "node:test";
import assert from "node:assert/strict";

import { PROTECTION_CHANNEL_FIELDS, resolveProtectionChannel } from "../../features/command-security/securityChannelResolution.js";
import { START_STOP_TOGGLE_FIELDS } from "../../features/command-security/securityCommandFields.js";
import { calls, loadModule } from "./sourceStructureQueries.js";
import { liveReadinessGaps } from "../../features/command-handlers/securityOverviewHandler.js";
import { moduleContext } from "../moduleContextStub.js";
import type { GuildSettingsLike } from "../../features/command-security/securitySettingsContracts.js";
import type { SecurityInteraction } from "../../features/command-security/securityInteractionContracts.js";

type SecurityOverviewGuild = NonNullable<SecurityInteraction["guild"]>;

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

test("fiecare cale care alege un canal de protectie foloseste aceeasi sursa de adevar (F-43)", () => {
  const consumers = [
    ["features", "command-security", "securityStatusModel.ts"],
    ["features", "command-handlers", "securityInteractionHandler.ts"],
    ["features", "command-handlers", "securityOverviewHandler.ts"],
    ["app", "runtime", "antiRaidGuildAdapter.ts"]
  ] as const;

  const without = consumers
    .filter(path => !calls(loadModule(...path)).some(call => call.callee === RESOLVER))
    .map(path => path.join("/"));

  assert.deepEqual(
    without,
    [],
    "start, runtime, modelul de status SI verificarea live de pregatire trebuie sa citeasca acelasi rezolvator. "
      + "Prima omisiune a facut anti-raid sa apara incomplet desi runtime-ul avea canal functional; a doua a fost "
      + "verificarea live, care sarea peste canalul de fallback si nu observa ca fusese sters sau ca botul pierduse permisiuni"
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

test("verificarea live prinde canalul de fallback sters (F-43)", async () => {
  const gaps = await liveReadinessGaps(
    moduleContext<GuildSettingsLike>({ antiRaidEnabled: true, antiRaidAlertChannelId: null, permissionRequestChannelId: "chan-cereri" }),
    moduleContext<SecurityOverviewGuild>({
      channels: { fetch: async () => null },
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } }
    })
  );

  assert.ok(
    (gaps["anti-raid"] ?? []).some(entry => entry.includes("nu mai este accesibil")),
    "canalul pe care runtime-ul chiar il foloseste trebuie verificat, altfel stergerea lui trece neobservata"
  );
});

test("verificarea live prinde permisiunile pierdute pe canalul de fallback (F-43)", async () => {
  const gaps = await liveReadinessGaps(
    moduleContext<GuildSettingsLike>({ antiRaidEnabled: true, antiRaidAlertChannelId: null, permissionRequestChannelId: "chan-cereri" }),
    moduleContext<SecurityOverviewGuild>({
      channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => false }) }) },
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } }
    })
  );

  assert.ok((gaps["anti-raid"] ?? []).length > 0, "un canal fara Send Messages nu poate primi alerte de raid");
});

test("cu canal de fallback functional, anti-raid nu primeste lipsuri de canal (F-43)", async () => {
  const gaps = await liveReadinessGaps(
    moduleContext<GuildSettingsLike>({ antiRaidEnabled: true, antiRaidAlertChannelId: null, permissionRequestChannelId: "chan-cereri" }),
    moduleContext<SecurityOverviewGuild>({
      channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => true }) }) },
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } }
    })
  );

  assert.deepEqual(
    (gaps["anti-raid"] ?? []).filter(entry => entry.includes("canal")),
    [],
    "fallback-ul functional nu are voie sa produca lipsuri inventate"
  );
});
