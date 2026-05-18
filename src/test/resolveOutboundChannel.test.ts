// @ts-check
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const attachNotifications = require("../features/notifications");

// resolveOutboundChannel lives inside the notifications module closure.
// Build a minimal ctx that satisfies the destructure at the top of that
// closure (everything ungranted just stays undefined; resolveOutboundChannel
// itself only touches logger and canSendEmbeds), then invoke the attach
// function so ctx.resolveOutboundChannel gets exposed.
function buildContext(overrides = {}) {
  const captured = { logs: [] };
  const ctx = {
    logger: (level, context, message, meta) => {
      captured.logs.push({ level, context, message, meta });
    },
    canSendEmbeds: () => true,
    // All other destructured deps from notifications can stay undefined;
    // none of them are reached by resolveOutboundChannel.
    ...overrides
  };
  attachNotifications(ctx);
  return { ctx, captured };
}

function makeClient(channelOrThrow, botId = "bot-id") {
  return {
    user: { id: botId },
    channels: {
      fetch: async () => {
        if (typeof channelOrThrow === "function") return channelOrThrow();
        return channelOrThrow;
      }
    }
  };
}

function makeDisableFnStub() {
  const calls = [];
  const fn = async (guildId, channelId, reason) => {
    calls.push({ guildId, channelId, reason });
  };
  return { fn, calls };
}

test("resolveOutboundChannel: permanent Discord code disables and aborts", async () => {
  const { ctx, captured } = buildContext();
  const err = Object.assign(new Error("Missing Access"), { code: 50001 });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient(() => { throw err; });

  const result = await ctx.resolveOutboundChannel({
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
  const { ctx, captured } = buildContext();
  const err = Object.assign(new Error("rate limited"), { code: 0 }); // not in DISCORD_PERMANENT_ERROR_CODES
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient(() => { throw err; });

  const result = await ctx.resolveOutboundChannel({
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
  const { ctx, captured } = buildContext();
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient(null);

  const result = await ctx.resolveOutboundChannel({
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
  // Override canSendEmbeds to return false for this case
  const { ctx, captured } = buildContext({ canSendEmbeds: () => false });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const fakeChannel = { id: "channel-4", isTextBased: () => true };
  const client = makeClient(fakeChannel);

  const result = await ctx.resolveOutboundChannel({
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

test("resolveOutboundChannel: healthy channel returns the channel without aborting", async () => {
  const { ctx } = buildContext({ canSendEmbeds: () => true });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const fakeChannel = { id: "channel-5", isTextBased: () => true };
  const client = makeClient(fakeChannel);

  const result = await ctx.resolveOutboundChannel({
    client,
    guild: { _id: "guild-5" },
    channelId: "channel-5",
    context: "TEST_OK",
    disableFn
  });

  assert.equal(result.abort, false);
  assert.equal(result.channel, fakeChannel);
  assert.equal(calls.length, 0, "no disable on happy path");
});

test("isPermanentDiscordError recognizes all four permanent codes", () => {
  const { ctx } = buildContext();
  for (const code of [10003, 10004, 50001, 50013]) {
    assert.equal(ctx.isPermanentDiscordError({ code }), true, `code ${code} should be permanent`);
  }
  // Non-permanent codes
  for (const code of [0, 429, 500, 50007]) {
    assert.equal(ctx.isPermanentDiscordError({ code }), false, `code ${code} should NOT be permanent`);
  }
  // Missing code
  assert.equal(ctx.isPermanentDiscordError({}), false, "no code = transient");
  assert.equal(ctx.isPermanentDiscordError(null), false, "null err = transient");
});

test("transientErrorMessage handles strings, errors, and weird inputs", () => {
  const { ctx } = buildContext();
  assert.equal(ctx.transientErrorMessage(new Error("kaboom")), "kaboom");
  assert.equal(ctx.transientErrorMessage({ message: "object with message" }), "object with message");
  assert.equal(ctx.transientErrorMessage(null), "null");
  assert.equal(ctx.transientErrorMessage(undefined), "undefined");
  assert.equal(ctx.transientErrorMessage("plain string"), "plain string");
});

export {};
