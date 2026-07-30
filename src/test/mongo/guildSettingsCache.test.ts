import test from "node:test";
import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import assert from "node:assert/strict";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import { guildChangePublisher } from "../../infra/mongo/models.js";
import type { GuildSettingsChangedListener } from "../../infra/mongo/guildSettingsEventBus.js";

const cacheBus = createGuildSettingsEventBus();
const publishGuildSettingsChanged = (guildId: string): void => cacheBus.publish(guildId);
const subscribeGuildSettingsChanged = (listener: GuildSettingsChangedListener): (() => void) => cacheBus.subscribe(listener);
const publishChangedGuild = guildChangePublisher(cacheBus);

import attachGuildSettings from "../../infra/mongo/guildSettings.js";

test("hook-ul post-query al schemei guild publica GuildSettingsChanged dupa commit, doar pentru _id-uri de guild reale (review nou, Mediu #16)", () => {
  const published: string[] = [];
  const unsubscribe = subscribeGuildSettingsChanged((guildId: string) => { published.push(guildId); });
  try {
    publishChangedGuild.call({ getFilter: () => ({ _id: "guild-hook-1" }) });
    publishChangedGuild.call({ getFilter: () => ({ _id: { $in: ["a", "b"] } }) });
    publishChangedGuild.call({ getFilter: () => ({}) });
    assert.deepEqual(published, ["guild-hook-1"], "publica exact o data pentru filtrul cu _id string; filtrele fara _id de guild nu emit nimic");
  } finally {
    unsubscribe();
  }
});

type GuildSettingsRuntime = {
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  invalidateGuildCache: (guildId: string) => void;
  getGuildCacheSize: () => number;
};

function makeContext(maxSize: number, fetchedIds: string[]): Parameters<typeof attachGuildSettings>[0] & Partial<GuildSettingsRuntime> {
  return {
    guildSettingsBus: createGuildSettingsEventBus(),
    env: {
      GUILD_CACHE_TTL_MS: 60_000,
      GUILD_CACHE_MAX_SIZE: maxSize
    },
    GuildModel: {
      findById(id: string) {
        fetchedIds.push(id);
        return {
          lean: async () => ({ _id: id, marker: `data-for-${id}` })
        };
      }
    }
  };
}

function asGuildSettingsRuntime(context: ReturnType<typeof makeContext>): Parameters<typeof attachGuildSettings>[0] & GuildSettingsRuntime {
  return context as Parameters<typeof attachGuildSettings>[0] & GuildSettingsRuntime;
}

function resetCacheFor(context: GuildSettingsRuntime, ids: string[]): void {
  for (const id of ids) context.invalidateGuildCache(id);
}

test("guildSettingsCache evicts oldest entries past GUILD_CACHE_MAX_SIZE", async () => {
  const fetched: string[] = [];
  const target = makeContext(3, fetched);
  const context = asGuildSettingsRuntime(target);
  attachGuildSettings(context);
  const ids = ["evict-g1", "evict-g2", "evict-g3", "evict-g4"];
  resetCacheFor(context, ids);

  await context.getGuildSettings(ids[0]);
  await context.getGuildSettings(ids[1]);
  await context.getGuildSettings(ids[2]);
  assert.ok(context.getGuildCacheSize() >= 3,
    "all three working-set entries must be cached after first fetch");

  await context.getGuildSettings(ids[3]);

  await context.getGuildSettings(ids[0]);
  assert.equal(fetched.filter(id => id === ids[0]).length, 2,
    `${ids[0]} must be re-fetched after eviction past cap`);
});

test("touching an entry refreshes its LRU position", async () => {
  const fetched: string[] = [];
  const target = makeContext(3, fetched);
  const context = asGuildSettingsRuntime(target);
  attachGuildSettings(context);
  const ids = ["touch-g1", "touch-g2", "touch-g3", "touch-g4"];
  resetCacheFor(context, ids);

  await context.getGuildSettings(ids[0]);
  await context.getGuildSettings(ids[1]);
  await context.getGuildSettings(ids[2]);

  await context.getGuildSettings(ids[0]);
  await context.getGuildSettings(ids[3]);

  await context.getGuildSettings(ids[0]);
  await context.getGuildSettings(ids[1]);

  assert.equal(fetched.filter(id => id === ids[0]).length, 1,
    `${ids[0]} stayed cached after the touch (only fetched once)`);
  assert.equal(fetched.filter(id => id === ids[1]).length, 2,
    `${ids[1]} was evicted by the bump, then re-fetched`);
});

test("GuildSettingsChanged invalideaza intrarea si forteaza recitirea din Mongo", async () => {
  const fetched: string[] = [];
  const target = makeContext(3, fetched);
  const context = asGuildSettingsRuntime(target);
  attachGuildSettings(context);
  const guildId = "changed-guild";
  context.invalidateGuildCache(guildId);
  await context.getGuildSettings(guildId);
  await context.getGuildSettings(guildId);
  target.guildSettingsBus.publish(guildId);
  await context.getGuildSettings(guildId);
  assert.equal(fetched.filter(id => id === guildId).length, 2, "invalidarea vine pe magistrala injectata in context");
});

test("o publicare pe alta magistrala nu invalideaza cache-ul acestui context", async () => {
  const fetched: string[] = [];
  const target = makeContext(3, fetched);
  const context = asGuildSettingsRuntime(target);
  attachGuildSettings(context);
  const guildId = "isolated-guild";
  context.invalidateGuildCache(guildId);
  await context.getGuildSettings(guildId);
  publishGuildSettingsChanged(guildId);
  await context.getGuildSettings(guildId);
  assert.equal(
    fetched.filter(id => id === guildId).length,
    1,
    "cat timp exista un singleton, orice runtime din proces invalida cache-ul oricarui alt runtime"
  );
});

