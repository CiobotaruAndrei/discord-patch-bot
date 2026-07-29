import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { MONGO_PORT_NAMES } from "../../infra/mongo/mongoPorts.js";
import { createMongoPorts } from "../../infra/mongo/mongoPortAdapters.js";
import type { MongoPorts } from "../../infra/mongo/mongoPorts.js";

const srcRoot = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, relative), "utf8");
}

function asContext(stub: Record<string, unknown>): Record<string, unknown> & Parameters<typeof createMongoPorts>[0] {
  return stub as Record<string, unknown> & Parameters<typeof createMongoPorts>[0];
}

test("porturile Mongo sunt interfete independente, nu felii din tipul concret", () => {
  const ports = read("infra/mongo/mongoPorts.ts");
  assert.ok(
    !ports.includes("MongoContextExports") && !ports.includes("mongoContext.js"),
    "un port taiat din contextul concret nu inverseaza nimic: ramane acelasi tip, doar mai ingust"
  );
  assert.ok(!/Pick</.test(ports), "porturile isi descriu propriile operatii");
  for (const name of MONGO_PORT_NAMES) {
    assert.match(ports, new RegExp(`^export interface ${name} \\{`, "m"), `${name} e declarat ca interfata proprie`);
  }
});

test("adaptoarele concrete traiesc in infrastructura si produc valori, nu doar tipuri", () => {
  const adapters = read("infra/mongo/mongoPortAdapters.ts");
  for (const factory of [
    "createGuildConfigStore",
    "createNotificationStore",
    "createSecurityStore",
    "createAuditStore",
    "createOperationStore",
    "createMongoPorts"
  ]) {
    assert.match(adapters, new RegExp(`export function ${factory}\\(`), `${factory} exista ca adaptor concret`);
  }
});

test("adaptorul chiar leaga operatiile portului de contextul primit", async () => {
  const calls: string[] = [];
  const model = {
    updateOne: async () => { calls.push("updateOne"); return {}; },
    countDocuments: async () => { calls.push("countDocuments"); return 0; }
  };
  const ports: MongoPorts = createMongoPorts(asContext({
    GuildModel: model,
    getGuildSettings: async (guildId: string) => { calls.push(`read:${guildId}`); return null; },
    invalidateGuildCache: (guildId: string) => { calls.push(`invalidate:${guildId}`); },
    cleanGuildCache: () => { calls.push("sweep"); },
    getGuildCacheSize: () => 7,
    OperationJournalModel: model,
    JobLockModel: model,
    acquireDbLock: async (job: string) => { calls.push(`acquire:${job}`); return "token"; },
    renewDbLock: async () => true,
    releaseDbLock: async (job: string) => { calls.push(`release:${job}`); }
  }));

  await ports.guildConfig.readSettings("g1");
  ports.guildConfig.invalidate("g1");
  ports.guildConfig.sweepExpired();
  assert.equal(ports.guildConfig.cachedCount(), 7);
  assert.equal(await ports.operations.acquire("job"), "token");
  await ports.operations.release("job", "token");

  assert.deepEqual(calls, ["read:g1", "invalidate:g1", "sweep", "acquire:job", "release:job"]);
});

test("un model lipsa nu darama portul, ci da o colectie inerta", async () => {
  const ports = createMongoPorts(asContext({}));
  assert.equal(await ports.notifications.outbox.countDocuments({}), 0);
  assert.deepEqual(
    await ports.notifications.outbox.updateOne({}, {}),
    { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 },
    "o colectie absenta raporteaza ca nu a atins nimic, nu arunca la prima folosire"
  );
});

test("porturile au consumatori reali, nu raman doar declarate", () => {
  const housekeeping = read("app/scheduler/housekeeping.ts");
  assert.match(housekeeping, /GuildConfigStore/, "curatarea periodica cere portul, nu functii libere");
  assert.match(housekeeping, /guildConfig\.sweepExpired\(\)/);
  assert.match(housekeeping, /DealsSourcePort/);
  assert.match(housekeeping, /deals\.sweepEnrichedCache\(\)/);
});

test("lista de porturi si interfetele exportate raman aliniate", () => {
  const ports = read("infra/mongo/mongoPorts.ts");
  const exported = [...ports.matchAll(/^export interface (\w+Store) \{/gm)].map(match => match[1]).sort();
  assert.deepEqual(
    exported,
    [...MONGO_PORT_NAMES].sort(),
    "un port nou trebuie adaugat si in lista, ca gate-urile si documentatia sa il vada"
  );
});
