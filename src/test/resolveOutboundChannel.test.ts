import test from "node:test";
import assert from "node:assert/strict";
import {
  createOutboundChannelResolver,
  isPermanentDiscordError,
  transientErrorMessage
} from "../features/notifications/outboundChannel";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

function buildResolver(overrides: Record<string, unknown> = {}) {
  const captured: { logs: Array<{ level: string; context: string; message: string; meta?: unknown }> } = { logs: [] };
  const resolveOutboundChannel = createOutboundChannelResolver({
    logger: (level, context, message, meta) => {
      captured.logs.push({ level, context, message, meta });
    },
    canSendEmbeds: () => true,
    ...overrides
  });
  return { resolveOutboundChannel, captured };
}

function makeClient(channelOrThrow: unknown, botId = "bot-id") {
  return {
    user: { id: botId },
    channels: {
      fetch: async () => {
        if (typeof channelOrThrow === "function") return (channelOrThrow as () => unknown)();
        return channelOrThrow;
      }
    }
  };
}

function makeDisableFnStub() {
  const calls: Array<{ guildId: string; channelId: string; reason: string }> = [];
  const fn = async (guildId: string, channelId: string, reason: string) => {
    calls.push({ guildId, channelId, reason });
  };
  return { fn, calls };
}

test("resolveOutboundChannel: permanent Discord code disables and aborts", async () => {
  const { resolveOutboundChannel, captured } = buildResolver();
  const err = Object.assign(new Error("Missing Access"), { code: 50001 });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient(() => { throw err; });

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-1" },
    channelId: "channel-1",
    context: "TEST_PERM",
    disableFn
  });

  assert.equal(result.abort, true);
  assert.equal(result.channel, null);
  assert.equal(calls.length, 1, "disableFn should be called exactly once");
  assert.equal(calls[0].guildId, "guild-1");
  assert.equal(calls[0].channelId, "channel-1");
  assert.match(calls[0].reason, /50001/);
  assert.ok(captured.logs.some(l => l.context === "TEST_PERM" && l.message.includes("permanenta")),
    "should log a WARN about permanent error");
});

test("resolveOutboundChannel: transient error skips cycle without disabling", async () => {
  const { resolveOutboundChannel, captured } = buildResolver();
  const err = Object.assign(new Error("rate limited"), { code: 0 });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient(() => { throw err; });

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-2" },
    channelId: "channel-2",
    context: "TEST_TRANSIENT",
    disableFn
  });

  assert.equal(result.abort, true);
  assert.equal(result.channel, null);
  assert.equal(calls.length, 0, "disableFn must NOT be called on transient errors");
  assert.ok(captured.logs.some(l => l.context === "TEST_TRANSIENT" && l.message.includes("tranzitorie")),
    "should log a WARN about transient error");
});

test("resolveOutboundChannel: fetch resolves to null is treated as channel deleted", async () => {
  const { resolveOutboundChannel, captured } = buildResolver();
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient(null);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-3" },
    channelId: "channel-3",
    context: "TEST_NULL",
    disableFn
  });

  assert.equal(result.abort, true);
  assert.equal(result.channel, null);
  assert.equal(calls.length, 1, "null channel should trigger disable");
  assert.match(calls[0].reason, /inexistent/i);
  assert.ok(captured.logs.some(l => l.context === "TEST_NULL"));
});

test("resolveOutboundChannel: channel without Send/Embed perms triggers disable", async () => {
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => false });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const fakeChannel = { id: "channel-4", isTextBased: () => true };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-4" },
    channelId: "channel-4",
    context: "TEST_PERMS",
    disableFn
  });

  assert.equal(result.abort, true);
  assert.equal(result.channel, null);
  assert.equal(calls.length, 1, "missing perms should trigger disable");
  assert.match(calls[0].reason, /permisiuni/);
});

test("resolveOutboundChannel: healthy channel returns a rate-limited channel that gates send", async () => {
  const order: string[] = [];
  const acquireSendSlot = async () => { order.push("acquire"); };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, acquireSendSlot });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const fakeChannel = {
    id: "channel-5",
    isTextBased: () => true,
    send: async (payload: unknown) => { order.push("send"); return { id: "msg", payload }; }
  };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-5" },
    channelId: "channel-5",
    context: "TEST_OK",
    disableFn
  });

  assert.equal(result.abort, false);
  assert.equal(calls.length, 0, "no disable on happy path");
  const channel = result.channel as { id: string; send: (payload: unknown) => Promise<unknown> };
  assert.equal(channel.id, "channel-5", "id-ul canalului este pastrat");
  await channel.send({ embeds: [] });
  assert.deepEqual(order, ["acquire", "send"], "rate limiter-ul este asteptat inainte de send");
});

test("resolveOutboundChannel: cu outbox activ, send enqueue-uieste in loc sa trimita direct", async () => {
  const enqueued: Array<{ guildId: string; channelId: string; kind: string; payload: unknown }> = [];
  const enqueueOutbox = async (job: { guildId: string; channelId: string; kind: "update" | "discount"; payload: unknown }) => {
    enqueued.push(job);
  };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, enqueueOutbox });
  const { fn: disableFn } = makeDisableFnStub();
  let directSends = 0;
  const fakeChannel = { id: "channel-9", isTextBased: () => true, send: async () => { directSends++; return { id: "msg" }; } };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-9" },
    channelId: "channel-9",
    context: "CRON_DISCOUNTS",
    disableFn
  });

  assert.equal(result.abort, false);
  const channel = result.channel as { id: string; send: (payload: unknown) => Promise<unknown> };
  await channel.send({ embeds: [{ t: 1 }] });
  assert.equal(directSends, 0, "nu trimite direct cand outbox e activ");
  assert.equal(enqueued.length, 1, "send-ul enqueue-uieste un job");
  assert.deepEqual(enqueued[0], { guildId: "guild-9", channelId: "channel-9", kind: "discount", payload: { embeds: [{ t: 1 }] } });
});

test("isPermanentDiscordError recognizes all four permanent codes", () => {
  for (const code of [10003, 10004, 50001, 50013]) {
    assert.equal(isPermanentDiscordError({ code }), true, `code ${code} should be permanent`);
  }
  for (const code of [0, 429, 500, 50007]) {
    assert.equal(isPermanentDiscordError({ code }), false, `code ${code} should NOT be permanent`);
  }
  assert.equal(isPermanentDiscordError({}), false, "no code = transient");
  assert.equal(isPermanentDiscordError(null), false, "null err = transient");
});

test("transientErrorMessage handles strings, errors, and weird inputs", () => {
  assert.equal(transientErrorMessage(new Error("kaboom")), "kaboom");
  assert.equal(transientErrorMessage({ message: "object with message" }), "object with message");
  assert.equal(transientErrorMessage(null), "null");
  assert.equal(transientErrorMessage(undefined), "undefined");
  assert.equal(transientErrorMessage("plain string"), "plain string");
});
