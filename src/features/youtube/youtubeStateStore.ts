"use strict";

import { updateTouchesSlice } from "../../shared/guildDomainSliceStore.js";
import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";

import type { SliceUpdate } from "../../shared/guildDomainSliceStore.js";
import type { YouTubeConfigGuildModel } from "./youtubeGuildConfigRepository.js";

export interface YoutubeStateModel {
  updateOne(filter: Record<string, unknown>, update: SliceUpdate, options?: Record<string, unknown>): Promise<unknown>;
  findOneAndUpdate(filter: Record<string, unknown>, update: SliceUpdate, options?: Record<string, unknown>): Promise<unknown>;
}

export function createYoutubeStateStore(
  guildModel: YouTubeConfigGuildModel,
  youtubeModel: YoutubeStateModel,
  onFirstMirror?: (guildId: string) => void
): YouTubeConfigGuildModel {
  const mirrored = new Set<string>();

  function guildIdOf(filter: object): string | null {
    const raw = (filter as { _id?: unknown })._id;
    return typeof raw === "string" ? raw : null;
  }

  function reportMirror(guildId: string): void {
    if (mirrored.has(guildId)) return;
    mirrored.add(guildId);
    onFirstMirror?.(guildId);
  }

  return {
    async updateOne(filter: object, update: object, options?: object) {
      const guildId = guildIdOf(filter);
      if (guildId && updateTouchesSlice(YOUTUBE_FIELDS, update as SliceUpdate)) {
        await youtubeModel.updateOne({ _id: guildId }, update as SliceUpdate, { ...(options ?? {}), upsert: true });
        reportMirror(guildId);
      }
      return guildModel.updateOne(filter, update, options);
    },

    async findOneAndUpdate(filter: object, update: object, options?: object) {
      const guildId = guildIdOf(filter);
      if (guildId && updateTouchesSlice(YOUTUBE_FIELDS, update as SliceUpdate)) {
        await youtubeModel.findOneAndUpdate({ _id: guildId }, update as SliceUpdate, { ...(options ?? {}), upsert: true });
        reportMirror(guildId);
      }
      return guildModel.findOneAndUpdate(filter, update, options);
    }
  };
}

export { YOUTUBE_FIELDS };
