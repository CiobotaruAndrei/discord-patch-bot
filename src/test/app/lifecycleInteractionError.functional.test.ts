import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";
import test from "node:test";
import assert from "node:assert/strict";
import { registerDiscordEvents } from "../../app/lifecycle/events.js";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type InteractionListener = (interaction: unknown) => unknown;

function makeHarness(handleInteraction: (interaction: unknown) => Promise<unknown> | unknown) {
  let interactionListener: InteractionListener | null = null;
  const client: Parameters<typeof registerDiscordEvents>[0]["client"] = {
    user: { id: "bot-1", tag: "bot#0001" },
    once: () => undefined,
    on: (event, listener) => {
      if (event === "interactionCreate") interactionListener = listener as InteractionListener;
    }
  };
  registerDiscordEvents({
    client,
    logger: () => undefined,
    metrics: createMetricRecorders(createMetrics()),
    commands: {
      registerSlashCommands: async () => undefined,
      handleInteraction: (interaction) => handleInteraction(interaction),
      canSendEmbeds: () => true
    },
    env: { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c" } as Parameters<typeof registerDiscordEvents>[0]["env"],
    adminAlert: async () => undefined,
    requestContext: { run: <T>(_store: { requestId: string }, cb: () => T) => cb() },
    games: [],
    crypto: { randomBytes: () => Buffer.from("abcdef") },
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    startHousekeeping: () => undefined,
    scheduleNextCron: () => undefined
  });
  return {
    fire: async (interaction: unknown) => {
      if (interactionListener) await interactionListener(interaction);
    }
  };
}

interface FakeInteraction {
  isRepliable: () => boolean;
  deferred: boolean;
  replied: boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp: (payload: unknown) => Promise<unknown>;
}

function makeInteraction(opts: { repliable: boolean; deferred?: boolean; replied?: boolean }) {
  const calls = { reply: 0, followUp: 0, lastPayload: undefined as unknown };
  const interaction: FakeInteraction = {
    isRepliable: () => opts.repliable,
    deferred: opts.deferred ?? false,
    replied: opts.replied ?? false,
    reply: async (payload: unknown) => { calls.reply++; calls.lastPayload = payload; },
    followUp: async (payload: unknown) => { calls.followUp++; calls.lastPayload = payload; }
  };
  return { interaction, calls };
}

function payloadFlags(payload: unknown): number | undefined {
  return (payload as { flags?: number } | undefined)?.flags;
}

test("interactionCreate: eroare top-level => raspuns ephemeral generic catre user (reply)", async () => {
  const { fire } = makeHarness(async () => { throw new Error("boom"); });
  const { interaction, calls } = makeInteraction({ repliable: true });
  await fire(interaction);
  assert.equal(calls.reply, 1, "userul primeste un raspuns ephemeral cand handler-ul arunca");
  assert.equal(calls.followUp, 0);
  assert.equal(payloadFlags(calls.lastPayload), 64, "flag-ul ephemeral (MessageFlags.Ephemeral = 64)");
  assert.match(String((calls.lastPayload as { content?: string }).content), /eroare/i);
});

test("interactionCreate: eroare cand interactiunea e deja deferred => followUp, nu reply", async () => {
  const { fire } = makeHarness(async () => { throw new Error("boom"); });
  const { interaction, calls } = makeInteraction({ repliable: true, deferred: true });
  await fire(interaction);
  assert.equal(calls.followUp, 1, "pe o interactiune deferred folosim followUp");
  assert.equal(calls.reply, 0);
  assert.equal(payloadFlags(calls.lastPayload), 64);
});

test("interactionCreate: eroare pe interactiune non-repliable (autocomplete) => niciun raspuns", async () => {
  const { fire } = makeHarness(async () => { throw new Error("boom"); });
  const { interaction, calls } = makeInteraction({ repliable: false });
  await fire(interaction);
  assert.equal(calls.reply, 0, "autocomplete nu e repliable, nu incercam sa raspundem");
  assert.equal(calls.followUp, 0);
});

test("interactionCreate: fara eroare => nu trimitem niciun raspuns de eroare", async () => {
  const { fire } = makeHarness(async () => undefined);
  const { interaction, calls } = makeInteraction({ repliable: true });
  await fire(interaction);
  assert.equal(calls.reply, 0, "happy-path nu produce raspuns de eroare");
  assert.equal(calls.followUp, 0);
});

test("interactionCreate: un reply care esueaza nu propaga eroarea (best-effort)", async () => {
  const { fire } = makeHarness(async () => { throw new Error("boom"); });
  const calls = { reply: 0 };
  const interaction = {
    isRepliable: () => true,
    deferred: false,
    replied: false,
    reply: async () => { calls.reply++; throw new Error("Unknown interaction"); }
  };
  await assert.doesNotReject(fire(interaction));
  assert.equal(calls.reply, 1, "am incercat reply, dar esecul lui nu trebuie sa arunce mai departe");
});
