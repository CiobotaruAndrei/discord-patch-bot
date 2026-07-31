"use strict";

import { updateTouchesSlice, writeCanonicalThenCopy } from "../../shared/guildDomainSliceStore.js";
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
  onFirstMirror?: (guildId: string) => void,
  onCopyFailed?: (guildId: string, error: unknown) => void
): YouTubeConfigGuildModel {
  const mirrored = new Set<string>();
  const reporters = {
    onCopied: (guildId: string) => {
      if (mirrored.has(guildId)) return;
      mirrored.add(guildId);
      onFirstMirror?.(guildId);
    },
    onCopyFailed
  };

  function guildIdOf(filter: object): string | null {
    const raw = (filter as { _id?: unknown })._id;
    return typeof raw === "string" ? raw : null;
  }

  return {
    async updateOne(filter: object, update: object, options?: object) {
      const guildId = guildIdOf(filter);
      return writeCanonicalThenCopy(
        guildId,
        updateTouchesSlice(YOUTUBE_FIELDS, update as SliceUpdate),
        () => guildModel.updateOne(filter, update, options),
        () => youtubeModel.updateOne({ _id: guildId }, update as SliceUpdate, { ...(options ?? {}), upsert: true }),
        reporters
      );
    },

    async findOneAndUpdate(filter: object, update: object, options?: object) {
      const guildId = guildIdOf(filter);
      return writeCanonicalThenCopy(
        guildId,
        updateTouchesSlice(YOUTUBE_FIELDS, update as SliceUpdate),
        () => guildModel.findOneAndUpdate(filter, update, options),
        () => youtubeModel.findOneAndUpdate({ _id: guildId }, update as SliceUpdate, { ...(options ?? {}), upsert: true }),
        reporters
      );
    }
  };
}

export { YOUTUBE_FIELDS };
