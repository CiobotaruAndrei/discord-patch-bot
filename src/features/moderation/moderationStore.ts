"use strict";

import { createGuildDomainSliceStore } from "../../shared/guildDomainSliceStore.js";

import type { ModerationGuildModel } from "./moderationRepository.js";

export const MODERATION_FIELDS = [
  "moderationTimeouts",
  "moderationMutes",
  "moderationWarnings",
  "moderationWarnBanLimit"
] as const;

export function createModerationStore(
  guildModel: ModerationGuildModel,
  moderationModel: ModerationGuildModel,
  onBackfill?: (guildId: string) => void
): ModerationGuildModel {
  return createGuildDomainSliceStore(MODERATION_FIELDS, guildModel, moderationModel, onBackfill);
}
