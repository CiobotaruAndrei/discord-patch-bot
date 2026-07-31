"use strict";

import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";

import type { YoutubeField } from "../../shared/guildYoutubeFields.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";

export type YoutubeSlice = Pick<GuildSettings, YoutubeField>;

export interface YoutubeSliceDocument extends YoutubeSlice {
  _id?: unknown;
}

export interface GuildLeanQuery<T> {
  lean(): Promise<T[]>;
}

export interface YoutubeGuildReaderModel {
  find(filter: Record<string, unknown>): GuildLeanQuery<GuildSettings>;
}

export interface YoutubeSliceReaderModel {
  find(filter: Record<string, unknown>): GuildLeanQuery<YoutubeSliceDocument>;
  updateOne?(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface YoutubeStateReaderDeps {
  guildModel: YoutubeGuildReaderModel;
  stateModel?: YoutubeSliceReaderModel;
  onMissingCopy?: (guildId: string) => void;
  onRepairFailed?: (guildId: string, error: unknown) => void;
}

export interface YoutubeStateReader {
  listActiveGuilds(): Promise<GuildSettings[]>;
}

const ACTIVE_FILTER = { "youtubeChannels.0": { $exists: true } };

function copyField<K extends YoutubeField>(target: YoutubeSlice, source: YoutubeSlice, field: K): void {
  const value = source[field];
  if (value !== undefined) target[field] = value;
}

function clearField<K extends YoutubeField>(target: YoutubeSlice, field: K): void {
  delete target[field];
}

function youtubeSliceOf(document: YoutubeSlice): YoutubeSlice {
  const slice: YoutubeSlice = {};
  for (const field of YOUTUBE_FIELDS) copyField(slice, document, field);
  return slice;
}

function withYoutubeSlice(guild: GuildSettings, slice: YoutubeSlice): GuildSettings {
  const merged: GuildSettings = { ...guild };
  for (const field of YOUTUBE_FIELDS) clearField(merged, field);
  return { ...merged, ...slice };
}

function idOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createYoutubeStateReader(deps: YoutubeStateReaderDeps): YoutubeStateReader {
  const { guildModel, stateModel, onMissingCopy, onRepairFailed } = deps;

  async function repairCopy(guildId: string, slice: YoutubeSlice): Promise<void> {
    onMissingCopy?.(guildId);
    if (!stateModel?.updateOne) return;
    try {
      await stateModel.updateOne({ _id: guildId }, { $set: slice }, { upsert: true });
    } catch (error: unknown) {
      onRepairFailed?.(guildId, error);
    }
  }

  async function guildsById(ids: readonly string[]): Promise<Map<string, GuildSettings>> {
    const found = new Map<string, GuildSettings>();
    if (ids.length === 0) return found;
    for (const guild of await guildModel.find({ _id: { $in: [...ids] } }).lean()) {
      found.set(guild._id, guild);
    }
    return found;
  }

  async function listActiveGuilds(): Promise<GuildSettings[]> {
    const legacy = await guildModel.find(ACTIVE_FILTER).lean();
    if (!stateModel) return legacy;

    const slices = new Map<string, YoutubeSlice>();
    for (const document of await stateModel.find(ACTIVE_FILTER).lean()) {
      const guildId = idOf(document._id);
      if (guildId) slices.set(guildId, youtubeSliceOf(document));
    }

    const active: GuildSettings[] = [];
    const enumerated = new Set<string>();
    for (const guild of legacy) {
      enumerated.add(guild._id);
      const slice = slices.get(guild._id);
      if (slice) {
        active.push(withYoutubeSlice(guild, slice));
        continue;
      }
      const fromLegacy = youtubeSliceOf(guild);
      await repairCopy(guild._id, fromLegacy);
      active.push(withYoutubeSlice(guild, fromLegacy));
    }

    const onlyDedicated = [...slices.keys()].filter(guildId => !enumerated.has(guildId));
    const bases = await guildsById(onlyDedicated);
    for (const guildId of onlyDedicated) {
      const slice = slices.get(guildId);
      if (!slice) continue;
      active.push(withYoutubeSlice(bases.get(guildId) ?? { _id: guildId }, slice));
    }
    return active;
  }

  return { listActiveGuilds };
}
