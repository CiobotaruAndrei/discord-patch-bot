import type { CacheEntry, GuildSettings, RuntimeEnv } from "../../types.js";
import { subscribeGuildSettingsChanged } from "./guildSettingsEvents.js";
import { normalizeGuildSettings } from "../../features/guild-config/guildAggregate.js";

interface GuildSettingsModelLike {
  findById(id: string): { lean(): Promise<(GuildSettings & Record<string, unknown>) | null> };
}

interface GuildSettingsContext {
  env: Pick<RuntimeEnv, "GUILD_CACHE_TTL_MS" | "GUILD_CACHE_MAX_SIZE">;
  GuildModel: GuildSettingsModelLike;
  getGuildSettings?: typeof getGuildSettings;
  invalidateGuildCache?: typeof invalidateGuildCache;
  cleanGuildCache?: typeof cleanGuildCache;
  getGuildCacheSize?: typeof getGuildCacheSize;
}

let runtimeContext: Pick<GuildSettingsContext, "env" | "GuildModel">;
const guildSettingsCache = new Map<string, CacheEntry<GuildSettings | null>>();

function maxCacheSize(): number {
  return runtimeContext.env.GUILD_CACHE_MAX_SIZE;
}

function touchEntry(guildId: string, entry: CacheEntry<GuildSettings | null>): void {

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
  const fresh = await runtimeContext.GuildModel.findById(guildId).lean();
  const normalized = fresh ? normalizeGuildSettings(fresh) : null;
  const entry = { data: normalized, expiresAt: now + runtimeContext.env.GUILD_CACHE_TTL_MS };
  guildSettingsCache.delete(guildId);
  guildSettingsCache.set(guildId, entry);
  evictOldestUntilUnderCap();
  return normalized;
}

function invalidateGuildCache(guildId: string): void {
  guildSettingsCache.delete(guildId);
}

subscribeGuildSettingsChanged(invalidateGuildCache);

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

function buildGuildSettingsFrom(context: GuildSettingsContext) {
  runtimeContext = {
    env: context.env,
    GuildModel: context.GuildModel
  };

  return {
    getGuildSettings,
    invalidateGuildCache,
    cleanGuildCache,
    getGuildCacheSize
  };
}

function attachGuildSettings(target: GuildSettingsContext): void {
  Object.assign(target, buildGuildSettingsFrom(target));
}

attachGuildSettings.buildFrom = buildGuildSettingsFrom;

export default attachGuildSettings;

