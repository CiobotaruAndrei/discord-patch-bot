import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

import { decodeOrThrow, executorsFrom, resourceKeysFrom, schemaVersionsFrom } from "../../features/admin-records/operationCodec.js";

type Map = { alfa: { guildId: string }; beta: { guildId: string } };

function tabel(executedInto: string[]) {
  return {
    alfa: {
      schemaVersion: 2,
      decode: (value: unknown) =>
        value && typeof value === "object" && typeof (value as { guildId?: unknown }).guildId === "string"
          ? { guildId: (value as { guildId: string }).guildId }
          : null,
      execute: async (payload: { guildId: string }) => { executedInto.push(payload.guildId); },
      resourceKey: (payload: { guildId: string }) => payload.guildId
    },
    beta: {
      schemaVersion: 5,
      decode: () => null,
      execute: async () => undefined,
      resourceKey: () => "beta"
    }
  };
}

test("versiunea, decodorul si executorul stau in acelasi obiect", () => {
  const versiuni = schemaVersionsFrom<Map>(tabel([]));
  assert.deepEqual(versiuni, { alfa: 2, beta: 5 },
    "inainte versiunile traiau intr-o harta separata de decodoare; urcata acolo si uitata aici, nimic nu prindea nepotrivirea");
});

test("un payload care nu trece decodorul opreste operatia cu versiunea in mesaj", async () => {
  const executate: string[] = [];
  const executors = executorsFrom<Map>(tabel(executate));

  await assert.rejects(
    executors.beta({ orice: 1 }, "op-1"),
    /payload invalid pentru operatia 'beta' \(schemaVersion 5\)/,
    "mesajul trebuie sa spuna ce versiune astepta, altfel un payload vechi ramas in jurnal se depaneaza greu"
  );
  assert.deepEqual(executate, [], "executorul nu ruleaza pe un payload pe care nu l-a validat nimeni");
});

test("un payload valid ajunge decodat la executor", async () => {
  const executate: string[] = [];
  const executors = executorsFrom<Map>(tabel(executate));
  await executors.alfa({ guildId: "g1" }, "op-2");
  assert.deepEqual(executate, ["g1"]);
});

test("cheia de resursa se obtine din acelasi decodor, nu dintr-o a doua citire a payload-ului", () => {
  const chei = resourceKeysFrom<Map>(tabel([]));
  assert.equal(chei.alfa({ guildId: "g7" }), "g7");
  assert.equal(chei.alfa({ fara: "guildId" }), null, "un payload invalid nu produce o cheie plauzibila");
});

test("decodeOrThrow nu lasa un `null` sa treaca drept payload", () => {
  const codec = tabel([]).beta;
  assert.throws(() => decodeOrThrow("beta", codec, {}), /schemaVersion 5/);
});

test("runtime-ul jurnalului isi deriva executorii si versiunile din codec-uri", () => {
  const runtime = fs.readFileSync(
    path.join(process.cwd(), "features", "admin-records", "operationJournalRuntime.ts"),
    "utf8"
  );
  assert.match(runtime, /executors: executorsFrom\(codecs\)/, "executorii se deriva, nu se scriu separat");
  assert.match(runtime, /schemaVersions: schemaVersionsFrom\(codecs\)/, "versiunile vin din acelasi tabel ca decodoarele");
  assert.ok(
    !/payload invalid pentru operatia '\$\{/.test(runtime),
    "verificarea payload-ului nu mai e repetata in fiecare executor; traieste o singura data, in codec"
  );
});
