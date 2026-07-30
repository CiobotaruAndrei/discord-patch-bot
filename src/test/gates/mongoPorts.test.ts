import test from "node:test";
import assert from "node:assert/strict";

import { MONGO_PORT_NAMES } from "../../infra/mongo/mongoPorts.js";
import { createMongoPorts } from "../../infra/mongo/mongoPortAdapters.js";
import type { MongoPorts } from "../../infra/mongo/mongoPorts.js";

import {
  loadModule,
  calls,
  declaresType,
  exportedFunctionNames,
  exportedTypeNames,
  identifierNames,
  importedModules,
  typeReferenceTexts
} from "./sourceStructureQueries.js";

const ports = loadModule("infra", "mongo", "mongoPorts.ts");
const adapters = loadModule("infra", "mongo", "mongoPortAdapters.ts");
const housekeeping = loadModule("app", "scheduler", "housekeeping.ts");

function asContext(stub: Record<string, unknown>): Record<string, unknown> & Parameters<typeof createMongoPorts>[0] {
  return stub as Record<string, unknown> & Parameters<typeof createMongoPorts>[0];
}

test("porturile Mongo sunt interfete independente, nu felii din tipul concret", () => {
  assert.ok(
    !identifierNames(ports).has("MongoContextExports"),
    "un port taiat din contextul concret nu inverseaza nimic: ramane acelasi tip, doar mai ingust"
  );
  assert.ok(
    !importedModules(ports).some(module => module.includes("mongoContext")),
    "portul nu importa contextul concret pe care ar trebui sa il inverseze"
  );
  assert.ok(
    !typeReferenceTexts(ports).some(text => text.startsWith("Pick<")),
    "porturile isi descriu propriile operatii, nu se taie dintr-un tip existent"
  );
  const exported = exportedTypeNames(ports);
  for (const name of MONGO_PORT_NAMES) {
    assert.ok(exported.includes(name), `${name} e exportat din modulul de porturi`);
    assert.ok(declaresType(ports, name), `${name} e declarat ca interfata proprie`);
  }
});

test("adaptoarele concrete traiesc in infrastructura si produc valori, nu doar tipuri", () => {
  const exported = exportedFunctionNames(adapters);
  for (const factory of [
    "createGuildConfigStore",
    "createNotificationStore",
    "createSecurityStore",
    "createAuditStore",
    "createOperationStore",
    "createMongoPorts"
  ]) {
    assert.ok(exported.includes(factory), `${factory} exista ca adaptor concret, exportat ca valoare`);
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
  const referenced = typeReferenceTexts(housekeeping);
  assert.ok(
    referenced.some(text => text.includes("GuildConfigStore")),
    "curatarea periodica cere portul de configurare, nu functii libere"
  );
  assert.ok(referenced.some(text => text.includes("DealsSourcePort")), "curatarea periodica cere si portul de surse");
  const invoked = calls(housekeeping).map(call => call.callee);
  assert.ok(invoked.includes("guildConfig.sweepExpired"), "portul de configurare e chiar apelat");
  assert.ok(invoked.includes("deals.sweepEnrichedCache"), "portul de surse e chiar apelat");
});

test("lista de porturi si interfetele exportate raman aliniate", () => {
  const exported = exportedTypeNames(ports)
    .filter(name => name.endsWith("Store"))
    .sort();
  assert.deepEqual(
    exported,
    [...MONGO_PORT_NAMES].sort(),
    "un port nou trebuie adaugat si in lista, ca gate-urile si documentatia sa il vada"
  );
});
