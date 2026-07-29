import test from "node:test";
import assert from "node:assert/strict";
import {
  createOutboundChannelResolver,
  isPermanentDiscordError,
  transientErrorMessage
} from "../../features/notifications/outboundChannel.js";
import { notificationKindForContext } from "../../features/notifications/notificationKinds.js";
import type { NotificationKind } from "../../features/notifications/notificationKinds.js";

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
    acquireSendSlot: async () => undefined,
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
  const enqueued: Array<{ guildId: string; channelId: string; kind: string; payload: unknown; recoveryVerify?: boolean; manual?: boolean; availableAt?: Date }> = [];
  const enqueueOutbox = async (job: { guildId: string; channelId: string; kind: "update" | "discount"; payload: unknown; recoveryVerify?: boolean; manual?: boolean; availableAt?: Date }) => {
    enqueued.push(job);
  };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, enqueueOutbox });
  const { fn: disableFn } = makeDisableFnStub();
  let directSends = 0;
  const fakeChannel = { id: "channel-9", isTextBased: () => true, send: async () => { directSends++; return { id: "msg" }; } };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-9", outboxRecoveryVerify: true },
    channelId: "channel-9",
    context: "CRON_DISCOUNTS",
    disableFn
  });

  assert.equal(result.abort, false);
  const channel = result.channel as { id: string; send: (payload: unknown) => Promise<unknown> };
  await channel.send({ embeds: [{ t: 1 }] });
  assert.equal(directSends, 0, "nu trimite direct cand outbox e activ");
  assert.equal(enqueued.length, 1, "send-ul enqueue-uieste un job");
  assert.deepEqual(enqueued[0], { guildId: "guild-9", channelId: "channel-9", kind: "discount", payload: { embeds: [{ t: 1 }] }, recoveryVerify: true, manual: undefined, history: undefined, availableAt: undefined });
});

test("resolveOutboundChannel: cu outbox activ si manual=true, jobul enqueued poarta manual:true (livrarea manuala supravietuieste lui /youtube notify off), R21 #2", async () => {
  const enqueued: Array<{ kind: string; manual?: boolean }> = [];
  const enqueueOutbox = async (job: { guildId: string; channelId: string; kind: "update" | "discount" | "youtube"; payload: unknown; recoveryVerify?: boolean; manual?: boolean; availableAt?: Date }) => {
    enqueued.push(job);
  };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, enqueueOutbox });
  const { fn: disableFn } = makeDisableFnStub();
  const fakeChannel = { id: "channel-y", isTextBased: () => true, send: async () => ({ id: "msg" }) };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-y" },
    channelId: "channel-y",
    context: "CRON_YOUTUBE",
    disableFn,
    manual: true
  });
  assert.equal(result.abort, false);
  const channel = result.channel as { id: string; send: (payload: unknown) => Promise<unknown> };
  await channel.send({ embeds: [] });
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].kind, "youtube");
  assert.equal(enqueued[0].manual, true, "flag-ul manual ajunge in jobul de outbox, ca drain predicate-ul sa nu-l scape pe motiv de notificari oprite");
});

test("resolveOutboundChannel: pe calea rate-limited, istoricul se scrie dupa send-ul real", async () => {
  const order: string[] = [];
  const recorded: Array<{ guildId: string; entries: unknown }> = [];
  const recordSentHistory = async (guildId: string, entries: Array<{ kind: "update" | "discount"; gameKey?: string; title?: string; link?: string }>) => {
    order.push("history");
    recorded.push({ guildId, entries });
  };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, acquireSendSlot: async () => { order.push("acquire"); }, recordSentHistory });
  const { fn: disableFn } = makeDisableFnStub();
  const fakeChannel = { id: "channel-10", isTextBased: () => true, send: async () => { order.push("send"); return { id: "msg" }; } };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-10" },
    channelId: "channel-10",
    context: "TEST_HISTORY",
    disableFn
  });

  assert.equal(result.abort, false);
  const channel = result.channel as { send: (payload: unknown, meta?: { historyEntries?: unknown[] }) => Promise<unknown> };
  await channel.send({ embeds: [] }, { historyEntries: [{ kind: "update", gameKey: "g1", title: "T", link: "L" }] });
  assert.deepEqual(order, ["acquire", "send", "history"], "istoricul se scrie abia dupa send-ul real catre Discord");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].guildId, "guild-10");
  assert.deepEqual(recorded[0].entries, [{ kind: "update", gameKey: "g1", title: "T", link: "L" }]);

  await channel.send({ embeds: [] });
  assert.equal(recorded.length, 1, "fara meta.historyEntries nu se scrie istoric");
});

test("resolveOutboundChannel: esecul scrierii istoricului nu strica send-ul real", async () => {
  const recordSentHistory = async () => { throw new Error("mongo down"); };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, acquireSendSlot: async () => undefined, recordSentHistory });
  const { fn: disableFn } = makeDisableFnStub();
  const fakeChannel = { id: "channel-11", isTextBased: () => true, send: async () => ({ id: "msg-11" }) };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-11" },
    channelId: "channel-11",
    context: "TEST_HISTORY_FAIL",
    disableFn
  });

  const channel = result.channel as { send: (payload: unknown, meta?: { historyEntries?: unknown[] }) => Promise<unknown> };
  const sent = await channel.send({ embeds: [] }, { historyEntries: [{ kind: "discount", title: "T" }] }) as { id: string };
  assert.equal(sent.id, "msg-11", "send-ul reuseste chiar daca scrierea istoricului esueaza");
});

test("resolveOutboundChannel: cu outbox activ, meta.historyEntries ajunge pe job.history fara scriere directa", async () => {
  const enqueued: Array<{ history?: unknown }> = [];
  const enqueueOutbox = async (job: { guildId: string; channelId: string; kind: "update" | "discount"; payload: unknown; recoveryVerify?: boolean; history?: unknown }) => {
    enqueued.push(job);
  };
  const recorded: unknown[] = [];
  const recordSentHistory = async (guildId: string, entries: unknown) => { recorded.push({ guildId, entries }); };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, enqueueOutbox, recordSentHistory });
  const { fn: disableFn } = makeDisableFnStub();
  const fakeChannel = { id: "channel-12", isTextBased: () => true, send: async () => ({ id: "msg" }) };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-12" },
    channelId: "channel-12",
    context: "CRON_UPDATES",
    disableFn
  });

  const channel = result.channel as { send: (payload: unknown, meta?: { historyEntries?: unknown[] }) => Promise<unknown> };
  await channel.send({ embeds: [] }, { historyEntries: [{ kind: "update", gameKey: "g2", title: "T2", link: "L2" }] });
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0].history, [{ kind: "update", gameKey: "g2", title: "T2", link: "L2" }]);
  assert.equal(recorded.length, 0, "la enqueue nu se scrie istoric; scrierea se face la livrarea din coada");
});

test("resolveOutboundChannel: channelId null inseamna abort fara disable (guild fara canal configurat)", async () => {
  const { resolveOutboundChannel, captured } = buildResolver();
  const { fn: disableFn, calls } = makeDisableFnStub();
  const client = makeClient({ id: "chan-x", send: async () => ({ id: "msg" }) });

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-nc" },
    channelId: null,
    context: "TEST_NO_CHANNEL",
    disableFn
  });

  assert.equal(result.abort, true);
  assert.equal(result.channel, null);
  assert.equal(calls.length, 0, "lipsa canalului configurat nu declanseaza disable (nu e eroare permanenta de canal)");
  assert.ok(captured.logs.some(l => l.context === "TEST_NO_CHANNEL" && l.message.includes("fara canal")),
    "se logheaza explicit ca guild-ul nu are canal configurat");
});

test("resolveOutboundChannel: canal cu permisiuni dar FARA functie send -> disable + abort (review #13.2)", async () => {
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true });
  const { fn: disableFn, calls } = makeDisableFnStub();
  const nonSendableChannel = { id: "channel-ns", isTextBased: () => true };
  const client = makeClient(nonSendableChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-ns" },
    channelId: "channel-ns",
    context: "TEST_NON_SENDABLE",
    disableFn
  });

  assert.equal(result.abort, true);
  assert.equal(result.channel, null);
  assert.equal(calls.length, 1, "canalul fara send e tratat ca invalid (disable), nu castat si lasat sa crape la trimitere");
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

test("resolveOutboundChannel: notificarile DLC intra in outbox cu propriul tip, nu deghizate in update", async () => {
  const enqueued: Array<{ kind: string }> = [];
  const enqueueOutbox = async (job: { guildId: string; channelId: string; kind: NotificationKind; payload: unknown; recoveryVerify?: boolean; manual?: boolean; availableAt?: Date }) => {
    enqueued.push(job);
  };
  const { resolveOutboundChannel } = buildResolver({ canSendEmbeds: () => true, enqueueOutbox });
  const { fn: disableFn } = makeDisableFnStub();
  const fakeChannel = { id: "channel-d", isTextBased: () => true, send: async () => ({ id: "msg" }) };
  const client = makeClient(fakeChannel);

  const result = await resolveOutboundChannel({
    client,
    guild: { _id: "guild-d" },
    channelId: "channel-d",
    context: "CRON_DLC",
    disableFn
  });
  const channel = result.channel as { send: (payload: unknown) => Promise<unknown> };
  await channel.send({ embeds: [] });

  assert.equal(enqueued.length, 1);
  assert.equal(
    enqueued[0].kind,
    "dlc",
    "contextul CRON_DLC cadea in ramura implicita si producea `update`; istoricul, dead-letter-ul si regulile " +
      "de abonare vedeau apoi un tip gresit, deci un guild care oprise update-urile pierdea si DLC-urile"
  );
});

test("un context necunoscut nu mai poate produce tacut un tip valid", () => {
  assert.equal(notificationKindForContext("CRON_DLC"), "dlc");
  assert.equal(notificationKindForContext("CRON_UPDATES"), "update");
  assert.equal(
    notificationKindForContext("CRON_CEVA_NOU"),
    undefined,
    "un cron nou trebuie sa se inregistreze explicit; altfel fallback-ul l-ar clasifica drept update fara sa se vada"
  );
});
