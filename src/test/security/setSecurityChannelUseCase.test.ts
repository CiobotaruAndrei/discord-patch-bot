import test from "node:test";
import assert from "node:assert/strict";

import {
  missingChannelPermissions,
  setSecurityChannel
} from "../../features/command-security/setSecurityChannelUseCase.js";

const permisiuniComplete = { viewChannel: true, sendMessages: true, embedLinks: true };

function deps(over: Partial<Parameters<typeof setSecurityChannel>[1]> = {}) {
  return {
    readPermissions: async () => permisiuniComplete,
    persist: async () => undefined,
    ...over
  };
}

test("fara camp sau fara canal, operatia nici nu porneste", async () => {
  const scrieri: string[] = [];
  const d = deps({ persist: async (_g, field) => { scrieri.push(field); } });

  assert.deepEqual(await setSecurityChannel({ guildId: "g", field: undefined, channelId: "c" }, d), { kind: "invalid-channel" });
  assert.deepEqual(await setSecurityChannel({ guildId: "g", field: "f", channelId: undefined }, d), { kind: "invalid-channel" });
  assert.deepEqual(scrieri, [], "nu se scrie nimic pentru o cerere pe care nu o putem interpreta");
});

test("permisiunile lipsa sunt numite, nu doar semnalate", async () => {
  const rezultat = await setSecurityChannel(
    { guildId: "g", field: "threatAlertChannelId", channelId: "c1" },
    deps({ readPermissions: async () => ({ viewChannel: true, sendMessages: false, embedLinks: false }) })
  );
  assert.deepEqual(
    rezultat,
    { kind: "missing-permissions", missing: ["Send Messages", "Embed Links"] },
    "un mesaj care insira toate cele trei permisiuni cand lipsesc doar doua trimite adminul sa caute gresit"
  );
});

test("permisiuni necunoscute inseamna toate lipsa, nu implicit permise", async () => {
  assert.deepEqual(missingChannelPermissions(null), ["View Channel", "Send Messages", "Embed Links"]);
  assert.deepEqual(missingChannelPermissions(undefined), ["View Channel", "Send Messages", "Embed Links"]);
  assert.deepEqual(
    missingChannelPermissions({ viewChannel: true }),
    ["Send Messages", "Embed Links"],
    "o permisiune absenta din raspuns nu e o permisiune acordata"
  );
});

test("canalul se scrie doar dupa ce permisiunile trec", async () => {
  const scrieri: Array<{ guildId: string; field: string; channelId: string }> = [];
  const rezultat = await setSecurityChannel(
    { guildId: "g7", field: "threatAlertChannelId", channelId: "c9" },
    deps({ persist: async (guildId, field, channelId) => { scrieri.push({ guildId, field, channelId }); } })
  );
  assert.deepEqual(rezultat, { kind: "saved", field: "threatAlertChannelId" });
  assert.deepEqual(scrieri, [{ guildId: "g7", field: "threatAlertChannelId", channelId: "c9" }]);
});

test("un esec de scriere e intors ca rezultat, nu aruncat peste handler", async () => {
  const eroare = new Error("mongo indisponibil");
  const rezultat = await setSecurityChannel(
    { guildId: "g", field: "f", channelId: "c" },
    deps({ persist: async () => { throw eroare; } })
  );
  assert.deepEqual(
    rezultat,
    { kind: "save-failed", error: eroare },
    "handler-ul trebuie sa poata alege ce raspunde utilizatorului; o exceptie ar sari peste raspunsul ephemeral"
  );
});
