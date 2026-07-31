import { sliceOf } from "../../shared/guildDomainSliceStore.js";

import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { CacheEntry } from "../../features/command-cache/commandCacheTypes.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import type { GuildSettingsEventBus } from "./guildSettingsEventBus.js";

interface GuildSettingsModelLike {
  findById(id: string): { lean(): Promise<(GuildSettings & Record<string, unknown>) | null> };
}

interface GuildSliceModelLike {
  findById(id: string): { lean(): Promise<Record<string, unknown> | null> };
  updateOne?(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}

export interface GuildSliceSource {
  domain: string;
  fields: readonly string[];
  model: GuildSliceModelLike;
}

interface GuildSettingsContext {
  env: Pick<RuntimeEnv, "GUILD_CACHE_TTL_MS" | "GUILD_CACHE_MAX_SIZE">;
  GuildModel: GuildSettingsModelLike;
  guildSettingsBus: GuildSettingsEventBus;
  guildSlices?: readonly GuildSliceSource[];
  onSliceCopyMissing?: (domain: string, guildId: string) => void;
  onSliceRepairFailed?: (domain: string, guildId: string, error: unknown) => void;
  getGuildSettings?: typeof getGuildSettings;
  invalidateGuildCache?: typeof invalidateGuildCache;
  cleanGuildCache?: typeof cleanGuildCache;
  getGuildCacheSize?: typeof getGuildCacheSize;
}

let runtimeContext: Pick<GuildSettingsContext, "env" | "GuildModel" | "onSliceCopyMissing" | "onSliceRepairFailed"> & {
  guildSlices: readonly GuildSliceSource[];
};
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

async function repairSliceCopy(source: GuildSliceSource, guildId: string, slice: Record<string, unknown>): Promise<void> {
  runtimeContext.onSliceCopyMissing?.(source.domain, guildId);
  if (!source.model.updateOne) return;
  try {
    await source.model.updateOne({ _id: guildId }, { $set: slice }, { upsert: true });
  } catch (error: unknown) {
    runtimeContext.onSliceRepairFailed?.(source.domain, guildId, error);
  }
}

async function loadWithSlices(guildId: string): Promise<(GuildSettings & Record<string, unknown>) | null> {
  const sources = runtimeContext.guildSlices;
  const [legacy, ...copies] = await Promise.all([
    runtimeContext.GuildModel.findById(guildId).lean(),
    ...sources.map(source => source.model.findById(guildId).lean())
  ]);
  let merged = legacy;
  for (const [index, source] of sources.entries()) {
    const copy = copies[index];
    if (copy) {
      const slice = sliceOf(source.fields, copy);
      merged = merged ? { ...merged, ...slice } : { _id: guildId, ...slice };
      continue;
    }
    if (!merged) continue;
    const fromLegacy = sliceOf(source.fields, merged);
    if (Object.keys(fromLegacy).length > 0) await repairSliceCopy(source, guildId, fromLegacy);
  }
  return merged;
}

async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  const now = Date.now();
  const cached = guildSettingsCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    touchEntry(guildId, cached);
    return cached.data;
  }
  const fresh = await loadWithSlices(guildId);
  const entry = { data: fresh, expiresAt: now + runtimeContext.env.GUILD_CACHE_TTL_MS };
  guildSettingsCache.delete(guildId);
  guildSettingsCache.set(guildId, entry);
  evictOldestUntilUnderCap();
  return fresh;
}

function invalidateGuildCache(guildId: string): void {
  guildSettingsCache.delete(guildId);
}

let unsubscribeFromBus: (() => void) | null = null;

function bindGuildSettingsBus(bus: GuildSettingsEventBus): () => void {
  unsubscribeFromBus?.();
  unsubscribeFromBus = bus.subscribe(invalidateGuildCache);
  return unsubscribeFromBus;
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

function buildGuildSettingsFrom(context: GuildSettingsContext) {
  runtimeContext = {
    env: context.env,
    GuildModel: context.GuildModel,
    guildSlices: context.guildSlices ?? [],
    onSliceCopyMissing: context.onSliceCopyMissing,
    onSliceRepairFailed: context.onSliceRepairFailed
  };
  bindGuildSettingsBus(context.guildSettingsBus);

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

