"use strict";

module.exports = (ctx) => {
  const { env, GuildModel } = ctx;

const GUILD_CACHE_TTL_MS = env.GUILD_CACHE_TTL_MS;
const guildSettingsCache = new Map();

async function getGuildSettings(guildId) {
  const now = Date.now();
  const cached = guildSettingsCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.data;
  const fresh = await GuildModel.findById(guildId).lean();
  guildSettingsCache.set(guildId, { data: fresh, expiresAt: now + GUILD_CACHE_TTL_MS });
  return fresh;
}

function invalidateGuildCache(guildId) {
  guildSettingsCache.delete(guildId);
}

function cleanGuildCache() {
  const now = Date.now();
  for (const [key, value] of guildSettingsCache.entries()) {
    if (value.expiresAt < now) guildSettingsCache.delete(key);
  }
}

function getGuildCacheSize() {
  return guildSettingsCache.size;
}

  Object.assign(ctx, {
    getGuildSettings,
    invalidateGuildCache,
    cleanGuildCache,
    getGuildCacheSize
  });
};
