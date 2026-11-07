import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { createShutdownController } from "../../app/lifecycle/shutdown.js";
import { createIngressActivityTracker } from "../../app/lifecycle/ingressActivityTracker.js";
import type { CreateShutdownControllerDeps } from "../../app/lifecycle/shutdown.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";

const realExit = process.exit;
const exitCodes: Array<string | number | null | undefined> = [];
before(() => {
  process.exit = ((code?: string | number | null) => { exitCodes.push(code); }) as typeof process.exit;
});
after(() => {
  process.exit = realExit;
});

interface LogLine {
  level: string;
  message: string;
  meta?: unknown;
}

function baseDeps(order: string[], logs: LogLine[], overrides: Partial<CreateShutdownControllerDeps> = {}): CreateShutdownControllerDeps {
  return {
    lifecycle: { isShuttingDown: false },
    logger: (level, _context, message, meta) => { logs.push({ level, message, meta }); },
    env: { SHUTDOWN_DRAIN_MS: 200 } as Pick<RuntimeEnv, "SHUTDOWN_DRAIN_MS">,
    client: { destroy: async () => { order.push("client.destroy"); } },
    mongoose: { connection: { close: async () => { order.push("mongo.close"); } } },
    httpServer: { close: (cb?: (err?: Error) => void) => { order.push("http.close"); cb?.(); } },
    activeLocks: new Map<string, string>(),
    releaseDbLock: async (jobName: string) => { order.push(`release:${jobName}`); },
    stopBudgetMs: 30,
    adminAlert: async () => undefined,
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    ...overrides
  };
}

test("tracker-ul numara operatiile active si anunta golirea, inclusiv pentru operatii care esueaza", async () => {
  const tracker = createIngressActivityTracker();
  let finishOk: () => void = () => undefined;
  let finishBad: (err: Error) => void = () => undefined;
  const ok = tracker.track("ok", new Promise<void>(resolve => { finishOk = resolve; }));
  const bad = tracker.track("bad", new Promise<void>((_resolve, reject) => { finishBad = reject; }));
  bad.catch(() => null);

  assert.equal(tracker.activeCount(), 2);
  assert.deepEqual(tracker.activeLabels().sort(), ["bad", "ok"]);

  const idle = tracker.waitForIdle(1_000);
  finishOk();
  finishBad(new Error("boom"));
  await ok;
  assert.equal(await idle, true, "o operatie esuata elibereaza slotul la fel ca una reusita");
  assert.equal(tracker.activeCount(), 0);
});

test("tracker-ul raporteaza expirarea cand o operatie nu se termina in timp", async () => {
  const tracker = createIngressActivityTracker();
  tracker.track("blocat", new Promise<void>(() => undefined));
  assert.equal(await tracker.waitForIdle(20), false);
  assert.equal(tracker.activeCount(), 1, "expirarea nu sterge operatia, doar raporteaza ca nu s-a terminat");
});

test("un stop care nu se rezolva produce timeout observabil, nu blocheaza shutdown-ul (B02)", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const logs: LogLine[] = [];
  const controller = createShutdownController(baseDeps(order, logs, {
    stopModerationCleanup: () => new Promise<void>(() => undefined),
    housekeeping: { stop: async () => { order.push("housekeeping.stop"); } }
  }));

  await controller.shutdown("SIGTERM");

  assert.ok(order.includes("housekeeping.stop"), "celelalte componente se opresc in paralel");
  assert.ok(order.includes("mongo.close"), "inchiderea ajunge pana la capat");
  assert.ok(
    logs.some(line => line.level === "ERROR" && line.message.includes("moderation-cleanup")),
    "timeout-ul numeste componenta care nu a confirmat oprirea"
  );
});

test("lock-urile nu se elibereaza cat timp un worker n-a confirmat oprirea (B02)", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const logs: LogLine[] = [];
  const controller = createShutdownController(baseDeps(order, logs, {
    activeLocks: new Map([["cron_main", "tok"]]),
    stopChannelLockRecovery: () => new Promise<void>(() => undefined)
  }));

  await controller.shutdown("SIGTERM");

  assert.ok(!order.includes("release:cron_main"), "un worker inca activ poate produce efecte; lease-ul expira prin TTL");
  assert.ok(logs.some(line => line.level === "WARN" && line.message.includes("TTL")));
});

test("lock-urile se elibereaza cand toate componentele s-au oprit", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const controller = createShutdownController(baseDeps(order, [], {
    activeLocks: new Map([["cron_main", "tok"]]),
    cronController: { stop: () => { order.push("cron.stop"); } }
  }));

  await controller.shutdown("SIGTERM");

  assert.ok(order.indexOf("cron.stop") < order.indexOf("release:cron_main"));
});

test("Mongo se inchide abia dupa ce operatiile gateway in zbor s-au terminat (B03)", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const ingress = createIngressActivityTracker();
  ingress.track("messageCreate", new Promise<void>(resolve => setTimeout(() => { order.push("handler.persist"); resolve(); }, 20)));

  await createShutdownController(baseDeps(order, [], { ingress })).shutdown("SIGTERM");

  assert.ok(order.indexOf("handler.persist") >= 0, "handler-ul a apucat sa persiste");
  assert.ok(order.indexOf("handler.persist") < order.indexOf("mongo.close"), "persistarea trebuie sa se termine inainte de close");
});

test("Redis se inchide tot dupa drain, fiindca handler-ele in zbor il folosesc (B03)", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const ingress = createIngressActivityTracker();
  ingress.track("antiRaid", new Promise<void>(resolve => setTimeout(() => { order.push("handler.redis"); resolve(); }, 20)));

  await createShutdownController(baseDeps(order, [], {
    ingress,
    redis: { close: async () => { order.push("redis.close"); } }
  })).shutdown("SIGTERM");

  assert.ok(order.indexOf("handler.redis") < order.indexOf("redis.close"));
});

test("un drain expirat e raportat explicit cu operatiile ramase, nu inchis in tacere (B03)", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const logs: LogLine[] = [];
  const ingress = createIngressActivityTracker();
  ingress.track("interactionCreate", new Promise<void>(() => undefined));

  await createShutdownController(baseDeps(order, logs, {
    ingress,
    env: { SHUTDOWN_DRAIN_MS: 20 } as Pick<RuntimeEnv, "SHUTDOWN_DRAIN_MS">
  })).shutdown("SIGTERM");

  const forced = logs.find(line => line.level === "ERROR" && line.message.includes("Drain expirat"));
  assert.ok(forced, "terminarea fortata trebuie sa fie vizibila in loguri");
  assert.deepEqual(forced.meta, { active: 1, operations: ["interactionCreate"] });
  assert.ok(order.includes("mongo.close"), "dupa raportare, terminarea fortata e definita: dependintele se inchid");
});

test("un close de Mongo blocat nu tine procesul agatat", { timeout: 5_000 }, async () => {
  const order: string[] = [];
  const logs: LogLine[] = [];
  await createShutdownController(baseDeps(order, logs, {
    mongoose: { connection: { close: () => new Promise<void>(() => undefined) } }
  })).shutdown("SIGTERM");

  assert.ok(order.includes("http.close"));
  assert.ok(logs.some(line => line.level === "ERROR" && line.message.includes("mongo")));
});
