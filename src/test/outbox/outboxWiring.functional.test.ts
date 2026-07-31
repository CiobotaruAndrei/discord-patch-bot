import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";
import test from "node:test";
import assert from "node:assert/strict";
import { registerDiscordEvents } from "../../app/lifecycle/events.js";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type ReadyListener = () => unknown;

function makeHarness(startOutboxWorker?: () => void) {
  let readyListener: ReadyListener | null = null;
  const calls = { housekeeping: 0, cron: 0, outbox: 0, slash: 0 };
  const client: Parameters<typeof registerDiscordEvents>[0]["client"] = {
    user: { id: "bot-1", tag: "bot#0001" },
    once: (event, listener) => { if (event === "ready") readyListener = listener; },
    on: () => undefined
  };
  registerDiscordEvents({
    client,
    logger: () => undefined,
    metrics: createMetricRecorders(createMetrics()),
    commands: {
      registerSlashCommands: async () => { calls.slash++; },
      handleInteraction: () => undefined,
      canSendEmbeds: () => true
    },
    env: { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c" } as Parameters<typeof registerDiscordEvents>[0]["env"],
    adminAlert: async () => undefined,
    requestContext: { run: <T>(_store: { requestId: string }, cb: () => T) => cb() },
    games: [],
    crypto: { randomBytes: () => Buffer.from("abcdef") },
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    startHousekeeping: () => { calls.housekeeping++; },
    scheduleNextCron: () => { calls.cron++; },
    startOutboxWorker: startOutboxWorker
      ? () => { calls.outbox++; startOutboxWorker(); }
      : undefined
  });
  return { fireReady: async () => { if (readyListener) await readyListener(); }, calls };
}

test("registerDiscordEvents porneste worker-ul de outbox in handler-ul ready (outbox drenat la boot)", async () => {
  let started = 0;
  const { fireReady, calls } = makeHarness(() => { started++; });
  await fireReady();
  assert.equal(started, 1, "startOutboxWorker este apelat o data la ready — outbox-ul are cine sa-l dreneze");
  assert.equal(calls.outbox, 1);
  assert.equal(calls.cron, 1, "cron-ul porneste in continuare");
  assert.equal(calls.housekeeping, 1);
});

test("registerDiscordEvents fara startOutboxWorker (outbox dezactivat) nu arunca si porneste restul", async () => {
  const { fireReady, calls } = makeHarness(undefined);
  await fireReady();
  assert.equal(calls.outbox, 0, "fara worker cand outbox-ul e dezactivat");
  assert.equal(calls.cron, 1, "cron-ul porneste normal");
  assert.equal(calls.housekeeping, 1);
});
