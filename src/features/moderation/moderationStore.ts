"use strict";

import { createGuildDomainSliceStore } from "../../shared/guildDomainSliceStore.js";
import { MODERATION_FIELDS } from "../../shared/guildModerationFields.js";

import type { ModerationGuildModel } from "./moderationRepository.js";

export { MODERATION_FIELDS };

export function createModerationStore(
  guildModel: ModerationGuildModel,
  moderationModel: ModerationGuildModel,
  onBackfill?: (guildId: string) => void
): ModerationGuildModel {
  return createGuildDomainSliceStore(MODERATION_FIELDS, guildModel, moderationModel, onBackfill);
}
