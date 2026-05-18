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

async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  const now = Date.now();
  const cached = guildSettingsCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.data;
  const fresh = await runtimeContext.GuildModel.findById(guildId).lean() as GuildSettings | null;
  guildSettingsCache.set(guildId, { data: fresh, expiresAt: now + runtimeContext.env.GUILD_CACHE_TTL_MS });
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
