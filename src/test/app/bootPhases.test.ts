import test from "node:test";
import assert from "node:assert/strict";

import {
  runCacheHydrationPhase,
  runDatabaseStartupPhase,
  runDiscordStartupPhase,
  runHttpStartupPhase
} from "../../app/lifecycle/bootPhases.js";

function makeLog() {
  const lines: Array<{ level: string; context: string; message: string }> = [];
  return {
    lines,
    logger: (level: string, context: string, message: string) => { lines.push({ level, context, message }); }
  };
}

test("databaseStartup: conecteaza, avertizeaza daca ready nu se confirma si logheaza migrarile aplicate", async () => {
  const { lines, logger } = makeLog();
  const order: string[] = [];
  await runDatabaseStartupPhase({
    connectMongo: async () => { order.push("connect"); },
    waitForMongoReady: async () => { order.push("ready"); return false; },
    runMigrations: async () => { order.push("migrations"); return { applied: [3, 4] }; },
    migrationsContinueOnError: false,
    logger,
    adminAlert: async () => undefined,
    errorMessage: err => String(err),
    errorDetail: err => String(err)
  });
  assert.deepEqual(order, ["connect", "ready", "migrations"], "fazele ruleaza in ordinea corecta");
  assert.ok(lines.some(line => line.context === "BOOT" && /nu a confirmat/.test(line.message)));
  assert.ok(lines.some(line => line.context === "MIGRATE" && /3, 4/.test(line.message)));
});

test("databaseStartup: migrari esuate => fail-fast fara adminAlert cand MIGRATIONS_CONTINUE_ON_ERROR e dezactivat", async () => {
  const alerts: string[] = [];
  await assert.rejects(
    () => runDatabaseStartupPhase({
      connectMongo: async () => undefined,
      waitForMongoReady: async () => true,
      runMigrations: async () => { throw new Error("schema drift"); },
      migrationsContinueOnError: false,
      logger: () => undefined,
      adminAlert: async kind => { alerts.push(kind); },
      errorMessage: err => String(err),
      errorDetail: err => String(err)
    }),
    /schema drift/
  );
  assert.deepEqual(alerts, [], "fail-fast opreste pornirea, nu alerteaza ca a pornit oricum");
});

test("databaseStartup: migrari esuate cu continue-on-error => porneste si trimite adminAlert boot:migrations", async () => {
  const alerts: string[] = [];
  await runDatabaseStartupPhase({
    connectMongo: async () => undefined,
    waitForMongoReady: async () => true,
    runMigrations: async () => { throw new Error("schema drift"); },
    migrationsContinueOnError: true,
    logger: () => undefined,
    adminAlert: async kind => { alerts.push(kind); },
    errorMessage: err => String(err),
    errorDetail: err => String(err)
  });
  assert.deepEqual(alerts, ["boot:migrations"]);
});

test("cacheHydration: esecul hidratarii doar avertizeaza, nu opreste boot-ul", async () => {
  const { lines, logger } = makeLog();
  await runCacheHydrationPhase({
    hydrateCaches: async () => { throw new Error("snapshot corupt"); },
    logger,
    errorMessage: err => String(err)
  });
  assert.ok(lines.some(line => line.level === "WARN" && /Hidratarea/.test(line.message)));
});

test("httpStartup: leaga handler-ul de eroare (cu adminAlert) si porneste listen pe portul dat", () => {
  const alerts: string[] = [];
  let listenPort: number | string | null = null;
  const errorListeners: Array<(err: Error) => void> = [];
  runHttpStartupPhase({
    httpServer: {
      on: (_event, listener) => { errorListeners.push(listener); return undefined; },
      listen: (port, callback) => { listenPort = port; callback?.(); return undefined; }
    },
    port: 8081,
    logger: () => undefined,
    adminAlert: async kind => { alerts.push(kind); },
    errorMessage: err => String(err),
    errorDetail: err => String(err)
  });
  assert.equal(listenPort, 8081);
  assert.equal(errorListeners.length, 1, "handler-ul de eroare e legat inainte de listen");
  errorListeners[0](new Error("EADDRINUSE"));
  assert.deepEqual(alerts, ["http:listen"]);
});

test("discordStartup: face login cu token-ul dat", async () => {
  const tokens: string[] = [];
  await runDiscordStartupPhase({
    client: { login: async token => { tokens.push(token); return "ok"; } },
    token: "token-discord"
  });
  assert.deepEqual(tokens, ["token-discord"]);
});
