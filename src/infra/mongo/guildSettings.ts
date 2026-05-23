import type { Model } from "mongoose";
import type { CacheEntry, GuildSettings, RuntimeEnv } from "../../types";

interface GuildSettingsContext {
  env: RuntimeEnv;
  GuildModel: Model<GuildSettings>;
  getGuildSettings?: typeof getGuildSettings;
  invalidateGuildCache?: typeof invalidateGuildCache;
  cleanGuildCache?: typeof cleanGuildCache;
  getGuildCacheSize?: typeof getGuildCacheSize;
}

let runtimeContext: Pick<GuildSettingsContext, "env" | "GuildModel">;
const guildSettingsCache = new Map<string, CacheEntry<GuildSettings | null>>();

// V11: bound LRU pentru cache. Inainte, Map-ul crestea nelimitat — singura
// curatire era `cleanGuildCache` (housekeeping) si numai pentru intrari
// expirate. Sub trafic cu multe guild-uri unice in TTL window, am fi tinut
// toate setarile in memorie pana la urmatorul housekeeping tick. Restul
// cache-urilor (deals, single, dlc, enriched, findGame) au deja bound;
// aliniem si pe asta. `GUILD_CACHE_MAX_SIZE` se poate redimensiona din env.
function maxCacheSize(): number {
  return runtimeContext.env.GUILD_CACHE_MAX_SIZE;
}

function touchEntry(guildId: string, entry: CacheEntry<GuildSettings | null>): void {
  // Re-insert to move to "newest" end (Map preserves insertion order).
  guildSettingsCache.delete(guildId);
  guildSettingsCache.set(guildId, entry);
}

function evictOldestUntilUnderCap(): void {
  const cap = maxCacheSize();
  while (guildSettingsCache.size > cap) {
    const oldest = guildSettingsCache.keys().next().value;
    if (oldest === undefined) break;
    guildSettingsCache.delete(oldest);
  }
}

async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  const now = Date.now();
  const cached = guildSettingsCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    touchEntry(guildId, cached);
    return cached.data;
  }
  const fresh = await runtimeContext.GuildModel.findById(guildId).lean() as GuildSettings | null;
  const entry = { data: fresh, expiresAt: now + runtimeContext.env.GUILD_CACHE_TTL_MS };
  guildSettingsCache.delete(guildId);
  guildSettingsCache.set(guildId, entry);
  evictOldestUntilUnderCap();
  return fresh;
}

function invalidateGuildCache(guildId: string): void {
  guildSettingsCache.delete(guildId);
}

function cleanGuildCache(): void {
  const now = Date.now();
  for (const [key, value] of guildSettingsCache.entries()) {
    if (value.expiresAt < now) guildSettingsCache.delete(key);
  }
  evictOldestUntilUnderCap();
}

function getGuildCacheSize(): number {
  return guildSettingsCache.size;
}

function attachGuildSettings(ctx: GuildSettingsContext): void {
  runtimeContext = {
    env: ctx.env,
    GuildModel: ctx.GuildModel
  };

  Object.assign(ctx, {
    getGuildSettings,
    invalidateGuildCache,
    cleanGuildCache,
    getGuildCacheSize
  });
}

export = attachGuildSettings;
