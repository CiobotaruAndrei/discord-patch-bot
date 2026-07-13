import test from "node:test";
import assert from "node:assert/strict";

import { runMongoConnectivityCheck } from "../../scripts/check-mongo.js";
import type { MongoConnectionProbe } from "../../scripts/check-mongo.js";

function createProbe(calls: string[], pingError?: Error, connectError?: Error): MongoConnectionProbe {
  return {
    connect: async (uri, timeoutMs) => {
      calls.push(`connect:${uri}:${timeoutMs}`);
      if (connectError) throw connectError;
    },
    ping: async () => {
      calls.push("ping");
      if (pingError) throw pingError;
    },
    databaseName: () => {
      calls.push("databaseName");
      return "discord-patch-bot";
    },
    disconnect: async () => {
      calls.push("disconnect");
    }
  };
}

test("verificarea MongoDB conecteaza, face ping, afiseaza baza si inchide conexiunea", async () => {
  const calls: string[] = [];
  const name = await runMongoConnectivityCheck("mongodb://localhost/bot", createProbe(calls), 1250);

  assert.equal(name, "discord-patch-bot");
  assert.deepEqual(calls, [
    "connect:mongodb://localhost/bot:1250",
    "ping",
    "databaseName",
    "disconnect"
  ]);
});

test("verificarea MongoDB inchide conexiunea cand ping-ul esueaza", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runMongoConnectivityCheck("mongodb://localhost/bot", createProbe(calls, new Error("ping esuat"))),
    /ping esuat/
  );
  assert.deepEqual(calls, [
    "connect:mongodb://localhost/bot:3000",
    "ping",
    "disconnect"
  ]);
});

test("verificarea MongoDB incearca deconectarea si cand conectarea esueaza", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runMongoConnectivityCheck("mongodb://localhost/bot", createProbe(calls, undefined, new Error("conectare esuata"))),
    /conectare esuata/
  );
  assert.deepEqual(calls, [
    "connect:mongodb://localhost/bot:3000",
    "disconnect"
  ]);
});

test("verificarea MongoDB refuza un URI gol inainte de conectare", async () => {
  const calls: string[] = [];
  await assert.rejects(runMongoConnectivityCheck(" ", createProbe(calls)), /MONGO_URI lipseste/);
  assert.deepEqual(calls, []);
});
