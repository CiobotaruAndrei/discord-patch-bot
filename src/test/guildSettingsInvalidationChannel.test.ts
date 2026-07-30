import test from "node:test";
import assert from "node:assert/strict";
import { createGuildSettingsInvalidationChannel, GUILD_SETTINGS_CHANNEL } from "../infra/redis/guildSettingsInvalidationChannel.js";
import { createGuildSettingsEventBus } from "../infra/mongo/guildSettingsEventBus.js";
import type { GuildSettingsChangedListener, GuildSettingsRemotePublisher } from "../infra/mongo/guildSettingsEventBus.js";
import type { RedisRuntime, RedisClientLike, RedisSubscriberLike } from "../infra/redis/redisClient.js";

type SubscribeListener = (message: string) => void;

const bus = createGuildSettingsEventBus();
const publishGuildSettingsChanged = (guildId: string): void => bus.publish(guildId);
const subscribeGuildSettingsChanged = (listener: GuildSettingsChangedListener): (() => void) => bus.subscribe(listener);
const setGuildSettingsRemotePublisher = (publisher: GuildSettingsRemotePublisher | null): void => bus.setRemotePublisher(publisher);

function makeFakeRedis() {
  const published: Array<{ channel: string; message: string }> = [];
  let onMessage: SubscribeListener | null = null;
  let subscriberOpen = false;
  const subscriber: RedisSubscriberLike = {
    on: () => undefined,
    connect: async () => { subscriberOpen = true; },
    quit: async () => { subscriberOpen = false; },
    subscribe: async (channel: string, listener: SubscribeListener) => { onMessage = listener; void channel; },
    get isOpen() { return subscriberOpen; }
  };
  const client = {
    on: () => undefined,
    connect: async () => undefined,
    quit: async () => undefined,
    ping: async () => "PONG",
    get: async () => null,
    set: async () => "OK",
    del: async () => 1,
    publish: async (channel: string, message: string) => { published.push({ channel, message }); return 1; },
    duplicate: () => subscriber,
    isOpen: true
  } as RedisClientLike;
  const runtime: RedisRuntime = {
    enabled: true,
    getClient: () => client,
    status: () => "connected",
    connect: async () => undefined,
    close: async () => undefined
  };
  return { runtime, published, fireRemote: (guildId: string) => { assert.ok(onMessage, "subscribe activ"); onMessage?.(guildId); }, isSubscriberOpen: () => subscriberOpen };
}

test("publish local ajunge si pe canalul Redis; mesajul remote invalideaza local FARA republish (fara bucla)", async () => {
  const { runtime, published, fireRemote, isSubscriberOpen } = makeFakeRedis();
  const logs: string[] = [];
  const channel = createGuildSettingsInvalidationChannel({ redis: runtime, logger: (_l: string, _c: string, msg: unknown) => { logs.push(String(msg)); }, bus });
  await channel.start();
  const seen: string[] = [];
  const un = subscribeGuildSettingsChanged((g: string) => seen.push(g));
  publishGuildSettingsChanged("g-local");
  assert.deepEqual(seen, ["g-local"], "listenerul local ruleaza");
  assert.deepEqual(published, [{ channel: GUILD_SETTINGS_CHANNEL, message: "g-local" }], "invalidarea pleaca pe Redis");
  fireRemote("g-remote");
  assert.deepEqual(seen, ["g-local", "g-remote"], "mesajul remote invalideaza local");
  assert.equal(published.length, 1, "mesajul remote NU e republicat (fara bucla infinita)");
  await channel.stop();
  assert.equal(isSubscriberOpen(), false, "stop inchide conexiunea de subscribe");
  publishGuildSettingsChanged("g-after-stop");
  assert.equal(published.length, 1, "dupa stop nu se mai publica remote");
  un();
});

test("Redis dezactivat: canalul ramane pe TTL, publish-ul local functioneaza fara publisher remote", async () => {
  const logs: string[] = [];
  const disabled: RedisRuntime = { enabled: false, getClient: () => null, status: () => "disabled", connect: async () => undefined, close: async () => undefined };
  const channel = createGuildSettingsInvalidationChannel({ redis: disabled, logger: (_l: string, _c: string, msg: unknown) => { logs.push(String(msg)); }, bus });
  await channel.start();
  assert.ok(logs.some(m => m.includes("TTL")), "fallback-ul pe TTL e logat explicit");
  const seen: string[] = [];
  const un = subscribeGuildSettingsChanged((g: string) => seen.push(g));
  assert.doesNotThrow(() => publishGuildSettingsChanged("g1"));
  assert.deepEqual(seen, ["g1"]);
  un();
  await channel.stop();
});

test("un publish remote care esueaza e logat si nu blocheaza invalidarea locala", async () => {
  const logs: Array<[string, string]> = [];
  setGuildSettingsRemotePublisher(() => { throw new Error("redis cazut"); });
  const seen: string[] = [];
  const un = subscribeGuildSettingsChanged((g: string) => seen.push(g));
  assert.doesNotThrow(() => publishGuildSettingsChanged("g2"));
  assert.deepEqual(seen, ["g2"], "invalidarea locala a rulat desi publish-ul remote a aruncat");
  un();
  setGuildSettingsRemotePublisher(null);
  void logs;
});
