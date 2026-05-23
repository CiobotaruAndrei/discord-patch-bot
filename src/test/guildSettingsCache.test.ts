import test from "node:test";
import assert from "node:assert/strict";

// guildSettings.ts uses CommonJS `export = attachGuildSettings`, so go through require.
const attachGuildSettings = require("../infra/mongo/guildSettings") as (ctx: any) => void;

function makeCtx(maxSize: number, fetchedIds: string[]) {
  return {
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

test("guildSettingsCache evicts oldest entries past GUILD_CACHE_MAX_SIZE", async () => {
  // V11 regression guard: before the LRU bound, this cache grew unbounded
  // because cleanGuildCache only removed expired entries. Under high traffic
  // with many distinct guildIds inside one TTL window, the Map could pin
  // every guild in memory until the next housekeeping tick.
  const fetched: string[] = [];
  const ctx: any = makeCtx(3, fetched);
  attachGuildSettings(ctx);

  await ctx.getGuildSettings("g1");
  await ctx.getGuildSettings("g2");
  await ctx.getGuildSettings("g3");
  assert.equal(ctx.getGuildCacheSize(), 3);

  await ctx.getGuildSettings("g4"); // should evict g1 (oldest)
  assert.equal(ctx.getGuildCacheSize(), 3);

  await ctx.getGuildSettings("g1"); // re-fetch since it was evicted
  assert.equal(fetched.filter(id => id === "g1").length, 2,
    "g1 must be re-fetched after eviction");
});

test("touching an entry refreshes its LRU position", async () => {
  const fetched: string[] = [];
  const ctx: any = makeCtx(3, fetched);
  attachGuildSettings(ctx);

  await ctx.getGuildSettings("g1");
  await ctx.getGuildSettings("g2");
  await ctx.getGuildSettings("g3");

  // Touch g1 — should bump it to newest so a subsequent insert evicts g2 instead.
  await ctx.getGuildSettings("g1");
  await ctx.getGuildSettings("g4"); // should now evict g2 (oldest after the bump)

  await ctx.getGuildSettings("g1"); // still cached, no extra fetch
  await ctx.getGuildSettings("g2"); // evicted, must be re-fetched

  assert.equal(fetched.filter(id => id === "g1").length, 1, "g1 stayed cached after the bump");
  assert.equal(fetched.filter(id => id === "g2").length, 2, "g2 was evicted, then re-fetched");
});
