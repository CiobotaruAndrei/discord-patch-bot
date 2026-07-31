"use strict";

import { updateTouchesSlice } from "../../shared/guildDomainSliceStore.js";

import type { SliceCopyWriter, SliceUpdate } from "../../shared/guildDomainSliceStore.js";
import type { GuildConfigWriteModelLike, GuildConfigWriteResult } from "./guildConfigRepository.js";

export interface GuildSliceTarget {
  domain: string;
  fields: readonly string[];
  model?: { updateOne(filter: Record<string, unknown>, update: SliceUpdate, options?: Record<string, unknown>): Promise<unknown> };
  journaledCopy?: SliceCopyWriter;
}

export interface GuildSliceWriteReporters {
  onCopied?: (domain: string, guildId: string) => void;
  onCopyFailed?: (domain: string, guildId: string, error: unknown) => void;
}

function guildIdOf(filter: Record<string, unknown>): string | null {
  const raw = filter._id;
  return typeof raw === "string" ? raw : null;
}

export function createGuildSliceWriteModel(
  guildModel: GuildConfigWriteModelLike,
  slices: readonly GuildSliceTarget[],
  reporters?: GuildSliceWriteReporters
): GuildConfigWriteModelLike {
  return {
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown> | Record<string, unknown>[],
      options?: Record<string, unknown>
    ): Promise<GuildConfigWriteResult> {
      const guildId = guildIdOf(filter);
      const result = await guildModel.updateOne(filter, update, options);
      if (!guildId) return result;
      for (const slice of slices) {
        if (!updateTouchesSlice(slice.fields, update)) continue;
        try {
          if (slice.journaledCopy) await slice.journaledCopy(guildId, update);
          else await slice.model?.updateOne({ _id: guildId }, update, { ...(options ?? {}), upsert: true });
          reporters?.onCopied?.(slice.domain, guildId);
        } catch (error: unknown) {
          reporters?.onCopyFailed?.(slice.domain, guildId, error);
        }
      }
      return result;
    }
  };
}
