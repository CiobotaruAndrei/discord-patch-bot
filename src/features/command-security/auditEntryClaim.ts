"use strict";

import { createdDocument } from "../../shared/persistenceOutcome.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";

export const AUDIT_CLAIM_TTL_MS = 10 * 60 * 1000;

export interface AuditEntryClaimModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<WriteCounts | null | undefined>;
}

export interface AuditEntryClaim {
  claim(guildId: string, entryId: string, now?: Date): Promise<boolean>;
}

export function createAuditEntryClaim(model: AuditEntryClaimModelLike): AuditEntryClaim {
  return {
    async claim(guildId, entryId, now = new Date()) {
      const result = await model.updateOne(
        { _id: `${guildId}:${entryId}` },
        {
          $setOnInsert: {
            _id: `${guildId}:${entryId}`,
            guildId,
            entryId,
            claimedAt: now,
            expiresAt: new Date(now.getTime() + AUDIT_CLAIM_TTL_MS)
          }
        },
        { upsert: true }
      );
      return createdDocument(result);
    }
  };
}
