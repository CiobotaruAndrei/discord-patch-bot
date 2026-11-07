import test from "node:test";
import assert from "node:assert/strict";

import { createMetrics } from "../../app/health/metrics.js";
import { createMetricRecorders } from "../../app/health/metricRecorders.js";
import { registerDiscordEvents } from "../../app/lifecycle/events.js";
import { createIngressActivityTracker } from "../../app/lifecycle/ingressActivityTracker.js";

type Listener = (...args: unknown[]) => unknown;

test("handler-ele de securitate lansate din gateway sunt urmarite pana se termina, ca shutdown-ul sa le astepte (B03)", async () => {
  const listeners = new Map<string, Listener[]>();
  const ingress = createIngressActivityTracker();
  let release: () => void = () => undefined;
  registerDiscordEvents({
    client: {
      user: { id: "bot-1", tag: "bot#0001" },
      once: () => undefined,
      on: (event, listener) => { listeners.set(event, [...(listeners.get(event) ?? []), listener as Listener]); }
    },
    logger: () => undefined,
    metrics: createMetricRecorders(createMetrics()),
    commands: { registerSlashCommands: async () => undefined, handleInteraction: async () => undefined, canSendEmbeds: () => true },
    env: { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c" } as Parameters<typeof registerDiscordEvents>[0]["env"],
    adminAlert: async () => undefined,
    requestContext: { run: <T>(_store: { requestId: string }, cb: () => T) => cb() },
    games: [],
    crypto: { randomBytes: () => Buffer.from("abcdef") },
    errorMessage: (err: unknown) => String(err),
    errorDetail: (err: unknown) => String(err),
    ingress,
    securityRuntime: {
      handleGuildMemberAdd: async () => undefined,
      handleMessageCreate: () => new Promise<void>(resolve => { release = resolve; }),
      handleChannelDelete: async () => undefined
    }
  });

  for (const listener of listeners.get("messageCreate") ?? []) listener({ guild: { id: "g1" }, author: { id: "u1" } });

  assert.equal(ingress.activeCount(), 1, "fara urmarire, shutdown-ul ar inchide Mongo sub o verificare de securitate in curs");
  assert.deepEqual(ingress.activeLabels(), ["handleMessageCreate"]);
  release();
  assert.equal(await ingress.waitForIdle(1_000), true);
});
