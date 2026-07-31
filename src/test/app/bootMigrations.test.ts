import { createBootSequence } from "../../app/appRuntime.js";
import { moduleContext } from "../moduleContextStub.js";
import test from "node:test";
import assert from "node:assert/strict";


function buildBoot(runMigrations: () => Promise<{ applied: number[] }>, continueOnError = false) {
  const calls = { login: 0, listen: 0 };
  const deps = {
    errorMessage: (e: unknown) => String(e),
    errorDetail: (e: unknown) => String(e),
    mongoose: { connect: async () => undefined, connection: { readyState: 1 } },
    redis: { connect: async () => undefined, close: async () => undefined },
    commands: { setUpdatesCache() { }, setDealsCache() { } },
    mongo: {
      logger: () => { },
      env: { MONGO_URI: "mongodb://localhost/test", MONGO_MAX_POOL_SIZE: 10, PORT: 3000, DISCORD_TOKEN: "token", MIGRATIONS_CONTINUE_ON_ERROR: continueOnError },
      adminAlert: async () => undefined,
      waitForMongoReady: async () => true,
      runMigrations,
      loadFetchSnapshot: async () => null,
      loadDealsFetchSnapshots: async () => []
    }
  };
  const ctx = {
    client: { login: async () => { calls.login++; } },
    httpServer: { on() { }, listen: (_p: number, cb?: () => void) => { calls.listen++; if (cb) cb(); }, close() { } }
  };
  return { start: createBootSequence(moduleContext<Parameters<typeof createBootSequence>[0]>(deps), moduleContext<Parameters<typeof createBootSequence>[1]>({ ...ctx, guildInvalidationChannel: { start: async () => undefined } })), calls };
}

test("P1.1: migrare esuata la boot -> fail-fast (start respinge, nu se ajunge la login)", async () => {
  const { start, calls } = buildBoot(async () => { throw new Error("migration boom"); });
  await assert.rejects(start(), /migration boom/, "boot-ul se opreste cand o migrare esueaza (implicit, env.MIGRATIONS_CONTINUE_ON_ERROR=false)");
  assert.equal(calls.login, 0, "nu s-a ajuns la client.login (boot abandonat inainte de pornirea efectiva)");
});

test("P1.1: env.MIGRATIONS_CONTINUE_ON_ERROR=true -> boot continua peste migrarea esuata (escape hatch, injectat prin env)", async () => {
  const { start, calls } = buildBoot(async () => { throw new Error("migration boom"); }, true);
  await start();
  assert.equal(calls.login, 1, "cu escape-hatch (injectat prin env, nu process.env), boot-ul porneste oricum (ajunge la login)");
});

test("P1.1: migrari reusite -> boot continua normal", async () => {
  const prev = process.env.MIGRATIONS_CONTINUE_ON_ERROR;
  delete process.env.MIGRATIONS_CONTINUE_ON_ERROR;
  try {
    const { start, calls } = buildBoot(async () => ({ applied: [1, 2] }));
    await start();
    assert.equal(calls.login, 1, "fara erori de migrare, boot-ul porneste");
    assert.equal(calls.listen, 1, "http server pornit");
  } finally {
    if (prev === undefined) delete process.env.MIGRATIONS_CONTINUE_ON_ERROR; else process.env.MIGRATIONS_CONTINUE_ON_ERROR = prev;
  }
});
