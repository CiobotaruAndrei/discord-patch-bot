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

// `guildSettingsCache` and `runtimeContext` are module-level singletons in
// `infra/mongo/guildSettings.ts`, so tests can carry state between each
// other. We use unique guild-id prefixes per test and explicitly invalidate
// the working set on entry to keep them isolated without exposing a "clear"
// hook from production code.
function resetCacheFor(ctx: any, ids: string[]): void {
  for (const id of ids) ctx.invalidateGuildCache(id);
}

test("guildSettingsCache evicts oldest entries past GUILD_CACHE_MAX_SIZE", async () => {
  // V11 regression guard: before the LRU bound, this cache grew unbounded
  // because cleanGuildCache only removed expired entries. Under high traffic
  // with many distinct guildIds inside one TTL window, the Map could pin
  // every guild in memory until the next housekeeping tick.
  const fetched: string[] = [];
  const ctx: any = makeCtx(3, fetched);
  attachGuildSettings(ctx);
  const ids = ["evict-g1", "evict-g2", "evict-g3", "evict-g4"];
  resetCacheFor(ctx, ids);

  await ctx.getGuildSettings(ids[0]);
  await ctx.getGuildSettings(ids[1]);
  await ctx.getGuildSettings(ids[2]);
  assert.ok(ctx.getGuildCacheSize() >= 3,
    "all three working-set entries must be cached after first fetch");

  await ctx.getGuildSettings(ids[3]); // should evict ids[0] (oldest of our working set)

  await ctx.getGuildSettings(ids[0]); // must be re-fetched since it was evicted
  assert.equal(fetched.filter(id => id === ids[0]).length, 2,
    `${ids[0]} must be re-fetched after eviction past cap`);
});

test("touching an entry refreshes its LRU position", async () => {
  const fetched: string[] = [];
  const ctx: any = makeCtx(3, fetched);
  attachGuildSettings(ctx);
  const ids = ["touch-g1", "touch-g2", "touch-g3", "touch-g4"];
  resetCacheFor(ctx, ids);

  await ctx.getGuildSettings(ids[0]);
  await ctx.getGuildSettings(ids[1]);
  await ctx.getGuildSettings(ids[2]);

  // Touch ids[0] — should bump it to newest so a subsequent insert evicts ids[1] instead.
  await ctx.getGuildSettings(ids[0]);
  await ctx.getGuildSettings(ids[3]);

  await ctx.getGuildSettings(ids[0]); // still cached, no extra fetch
  await ctx.getGuildSettings(ids[1]); // evicted, must be re-fetched

  assert.equal(fetched.filter(id => id === ids[0]).length, 1,
    `${ids[0]} stayed cached after the touch (only fetched once)`);
  assert.equal(fetched.filter(id => id === ids[1]).length, 2,
    `${ids[1]} was evicted by the bump, then re-fetched`);
});
