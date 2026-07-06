import test from "node:test";
import assert from "node:assert/strict";
import { registerDiscordEvents } from "../app/lifecycle/events";
import { resolveBotRole, roleRunsSchedulers, roleRunsInteractions } from "../shared/botRole";
import { createMetrics } from "../app/health/metrics";
import type { BotRole } from "../types";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";

function makeRoleHarness(role: BotRole | undefined) {
  const calls = { registerSlashCommands: 0, startHousekeeping: 0, scheduleNextCron: 0, startOutboxWorker: 0 };
  const registeredEvents: string[] = [];
  let readyListener: (() => Promise<void> | void) | null = null;

  const client: Parameters<typeof registerDiscordEvents>[0]["client"] = {
    user: { id: "bot-1", tag: "bot#0001" },
    once: (event, listener) => { if (event === "ready") readyListener = listener as () => Promise<void> | void; },
    on: (event) => { registeredEvents.push(event); }
  };

  registerDiscordEvents({
    client,
    logger: () => undefined,
    metrics: createMetrics(),
    commands: {
      registerSlashCommands: async () => { calls.registerSlashCommands++; },
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
    startHousekeeping: () => { calls.startHousekeeping++; },
    scheduleNextCron: () => { calls.scheduleNextCron++; },
    startOutboxWorker: () => { calls.startOutboxWorker++; },
    role
  });

  return {
    calls,
    registeredEvents,
    fireReady: async () => { if (readyListener) await readyListener(); }
  };
}

test("resolveBotRole: normalizeaza si cade pe 'all' pentru valori invalide/lipsa", () => {
  assert.equal(resolveBotRole("web"), "web");
  assert.equal(resolveBotRole("worker"), "worker");
  assert.equal(resolveBotRole("all"), "all");
  assert.equal(resolveBotRole("WORKER"), "worker", "case-insensitive");
  assert.equal(resolveBotRole("  web  "), "web", "trim");
  assert.equal(resolveBotRole(undefined), "all", "lipsa -> all");
  assert.equal(resolveBotRole(""), "all", "gol -> all");
  assert.equal(resolveBotRole("orchestrator"), "all", "valoare invalida -> all");
});

test("roleRunsSchedulers / roleRunsInteractions: web fara schedulere, worker fara interactiuni", () => {
  assert.equal(roleRunsSchedulers("all"), true);
  assert.equal(roleRunsInteractions("all"), true);
  assert.equal(roleRunsSchedulers("web"), false, "web nu ruleaza job-uri de fundal");
  assert.equal(roleRunsInteractions("web"), true, "web trateaza interactiuni");
  assert.equal(roleRunsSchedulers("worker"), true, "worker ruleaza job-urile de fundal");
  assert.equal(roleRunsInteractions("worker"), false, "worker nu trateaza interactiuni");
});

test("registerDiscordEvents rol 'all' (implicit): porneste TOT — slash commands, schedulere, interactiuni", async () => {
  const h = makeRoleHarness("all");
  await h.fireReady();
  assert.deepEqual(h.calls, { registerSlashCommands: 1, startHousekeeping: 1, scheduleNextCron: 1, startOutboxWorker: 1 });
  assert.ok(h.registeredEvents.includes("interactionCreate"), "cableaza interactionCreate");
  assert.ok(h.registeredEvents.includes("guildCreate"), "cableaza onboarding-ul guildCreate");
});

test("registerDiscordEvents fara rol => implicit 'all' (compatibil cu comportamentul actual)", async () => {
  const h = makeRoleHarness(undefined);
  await h.fireReady();
  assert.deepEqual(h.calls, { registerSlashCommands: 1, startHousekeeping: 1, scheduleNextCron: 1, startOutboxWorker: 1 });
  assert.ok(h.registeredEvents.includes("interactionCreate"));
});

test("registerDiscordEvents rol 'web': interactiuni + slash commands, DAR fara schedulere de fundal", async () => {
  const h = makeRoleHarness("web");
  await h.fireReady();
  assert.equal(h.calls.registerSlashCommands, 1, "web inregistreaza slash commands");
  assert.equal(h.calls.startHousekeeping, 0, "web NU porneste housekeeping");
  assert.equal(h.calls.scheduleNextCron, 0, "web NU porneste cron");
  assert.equal(h.calls.startOutboxWorker, 0, "web NU porneste worker-ul outbox");
  assert.ok(h.registeredEvents.includes("interactionCreate"), "web trateaza interactiuni");
});

test("registerDiscordEvents rol 'worker': schedulere de fundal, DAR fara interactiuni/slash/onboarding", async () => {
  const h = makeRoleHarness("worker");
  await h.fireReady();
  assert.equal(h.calls.startHousekeeping, 1, "worker porneste housekeeping");
  assert.equal(h.calls.scheduleNextCron, 1, "worker porneste cron");
  assert.equal(h.calls.startOutboxWorker, 1, "worker porneste worker-ul outbox");
  assert.equal(h.calls.registerSlashCommands, 0, "worker NU inregistreaza slash commands");
  assert.ok(!h.registeredEvents.includes("interactionCreate"), "worker NU cableaza interactionCreate");
  assert.ok(!h.registeredEvents.includes("guildCreate"), "worker NU cableaza onboarding-ul guildCreate");
});
