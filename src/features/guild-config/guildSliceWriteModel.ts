"use strict";

import { splitUpdateBySlice, updateTouchesSlice } from "../../shared/guildDomainSliceStore.js";

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

function legacyPortion(
  owned: ReadonlyArray<readonly string[]>,
  update: Record<string, unknown> | Record<string, unknown>[]
): Record<string, unknown> | Record<string, unknown>[] | null {
  if (Array.isArray(update)) return update;
  let remaining: Record<string, unknown> | null = update;
  for (const fields of owned) {
    if (!remaining) return null;
    remaining = splitUpdateBySlice(fields, remaining).rest;
  }
  return remaining;
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
      if (!guildId) return guildModel.updateOne(filter, update, options);

      const ownedFields = slices.filter(slice => updateTouchesSlice(slice.fields, update));
      for (const slice of ownedFields) {
        const { own } = splitUpdateBySlice(slice.fields, update);
        if (own) {
          await slice.model?.updateOne({ _id: guildId }, own, { ...(options ?? {}), upsert: true });
          reporters?.onCopied?.(slice.domain, guildId);
          continue;
        }
        try {
          if (slice.journaledCopy) await slice.journaledCopy(guildId, update);
          else await slice.model?.updateOne({ _id: guildId }, update, { ...(options ?? {}), upsert: true });
          reporters?.onCopied?.(slice.domain, guildId);
        } catch (error: unknown) {
          reporters?.onCopyFailed?.(slice.domain, guildId, error);
        }
      }
      const legacyUpdate = legacyPortion(ownedFields.map(slice => slice.fields), update);
      if (!legacyUpdate) return { matchedCount: 1, modifiedCount: 1 };
      return guildModel.updateOne(filter, legacyUpdate, options);
    }
  };
}
