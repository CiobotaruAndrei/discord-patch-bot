import test from "node:test";
import assert from "node:assert/strict";
import { createMetrics } from "../../app/health/metrics.js";
import { registerDiscordEvents } from "../../app/lifecycle/events.js";
import type { BotMetrics } from "../../app/health/metricsTypes.js";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";

type InteractionListener = (interaction: unknown) => unknown;

function makeHarness(handleInteraction: (interaction: unknown) => Promise<unknown> | unknown) {
  const metrics: BotMetrics = createMetrics();
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
    metrics,
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
    metrics,
    fire: async (interaction: unknown) => {
      if (interactionListener) await interactionListener(interaction);
    }
  };
}

function chatCommand(name: string) {
  return {
    isChatInputCommand: () => true,
    isRepliable: () => true,
    commandName: name,
    deferred: false,
    replied: false,
    reply: async () => undefined
  };
}

test("metrici comenzi: fiecare interactiune chat-input incrementeaza runs + durata per comanda (R9 #6)", async () => {
  const { metrics, fire } = makeHarness(async () => undefined);
  await fire(chatCommand("ping"));
  await fire(chatCommand("ping"));
  await fire(chatCommand("help"));
  assert.deepEqual(metrics.commandRuns, { ping: 2, help: 1 });
  assert.deepEqual(metrics.commandErrors, {});
  assert.ok(typeof metrics.commandDurationMsTotal.ping === "number" && metrics.commandDurationMsTotal.ping >= 0, "durata totala per comanda e acumulata");
});

test("metrici comenzi: eroarea scapata la top-level incrementeaza errors, iar runs numara si esecul", async () => {
  const { metrics, fire } = makeHarness(async () => { throw new Error("boom"); });
  await fire(chatCommand("backup"));
  assert.deepEqual(metrics.commandRuns, { backup: 1 });
  assert.deepEqual(metrics.commandErrors, { backup: 1 });
});

test("metrici comenzi: interactiunile non-chat (autocomplete/modal) nu ating metricile de comenzi", async () => {
  const { metrics, fire } = makeHarness(async () => undefined);
  await fire({ isChatInputCommand: () => false, isRepliable: () => false, commandName: "ping" });
  await fire({ isRepliable: () => false });
  assert.deepEqual(metrics.commandRuns, {});
  assert.deepEqual(metrics.commandErrors, {});
  assert.deepEqual(metrics.commandDurationMsTotal, {});
});
