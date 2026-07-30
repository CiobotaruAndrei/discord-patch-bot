"use strict";

import { updateTouchesSlice } from "../../shared/guildDomainSliceStore.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";

import type { SliceUpdate } from "../../shared/guildDomainSliceStore.js";
import type { GuildConfigWriteModelLike, GuildConfigWriteResult } from "../guild-config/guildConfigRepository.js";

export interface SecurityStateModel {
  updateOne(
    filter: Record<string, unknown>,
    update: SliceUpdate,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}

export function createSecurityStore(
  guildModel: GuildConfigWriteModelLike,
  securityModel: SecurityStateModel,
  onFirstMirror?: (guildId: string) => void
): GuildConfigWriteModelLike {
  const mirrored = new Set<string>();

  return {
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown> | Record<string, unknown>[],
      options?: Record<string, unknown>
    ): Promise<GuildConfigWriteResult> {
      const raw = filter._id;
      const guildId = typeof raw === "string" ? raw : null;
      if (guildId && updateTouchesSlice(SECURITY_FIELDS, update)) {
        await securityModel.updateOne({ _id: guildId }, update, { ...options, upsert: true });
        if (!mirrored.has(guildId)) {
          mirrored.add(guildId);
          onFirstMirror?.(guildId);
        }
      }
      return guildModel.updateOne(filter, update, options);
    }
  };
}

export { SECURITY_FIELDS };
