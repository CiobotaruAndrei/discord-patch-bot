"use strict";

import { splitUpdateBySlice, updateTouchesSlice, writeCanonicalThenCopy } from "../../shared/guildDomainSliceStore.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";

import type { SliceCopyWriter, SliceUpdate } from "../../shared/guildDomainSliceStore.js";
import type { GuildConfigWriteModelLike, GuildConfigWriteResult } from "../guild-config/guildConfigRepository.js";

export interface SecurityStateModel {
  updateOne(
    filter: Record<string, unknown>,
    update: SliceUpdate,
    options?: Record<string, unknown>
  ): Promise<GuildConfigWriteResult>;
}

export function createSecurityStore(
  guildModel: GuildConfigWriteModelLike,
  securityModel: SecurityStateModel,
  onFirstMirror?: (guildId: string) => void,
  onCopyFailed?: (guildId: string, error: unknown) => void,
  journaledCopy?: SliceCopyWriter
): GuildConfigWriteModelLike {
  const mirrored = new Set<string>();
  const reporters = {
    onCopied: (guildId: string) => {
      if (mirrored.has(guildId)) return;
      mirrored.add(guildId);
      onFirstMirror?.(guildId);
    },
    onCopyFailed
  };

  return {
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown> | Record<string, unknown>[],
      options?: Record<string, unknown>
    ): Promise<GuildConfigWriteResult> {
      const raw = filter._id;
      const guildId = typeof raw === "string" ? raw : null;
      if (!guildId || !updateTouchesSlice(SECURITY_FIELDS, update)) {
        return guildModel.updateOne(filter, update, options);
      }
      const { own, rest } = splitUpdateBySlice(SECURITY_FIELDS, update);
      if (!own) {
        return writeCanonicalThenCopy(
          guildId,
          true,
          () => guildModel.updateOne(filter, update, options),
          () => journaledCopy
            ? journaledCopy(guildId, update)
            : securityModel.updateOne({ _id: guildId }, update, { ...options, upsert: true }),
          reporters
        );
      }
      const written = await securityModel.updateOne({ _id: guildId }, own, { ...options, upsert: true });
      reporters.onCopied(guildId);
      if (!rest) return written;
      await guildModel.updateOne(filter, rest, options);
      return written;
    }
  };
}

export { SECURITY_FIELDS };
