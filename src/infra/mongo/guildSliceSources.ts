import { MODERATION_FIELDS } from "../../shared/guildModerationFields.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";
import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";

import type { LoggerFunction } from "../../shared/logging.js";
import type { GuildSliceSource } from "./guildSettings.js";

interface GuildSliceSourcesContext {
  logger: LoggerFunction;
  GuildModerationModel: GuildSliceSource["model"];
  GuildSecurityModel: GuildSliceSource["model"];
  GuildYoutubeStateModel: GuildSliceSource["model"];
  guildSlices?: readonly GuildSliceSource[];
  onSliceCopyMissing?: (domain: string, guildId: string) => void;
  onSliceRepairFailed?: (domain: string, guildId: string, error: unknown) => void;
}

function buildGuildSliceSourcesFrom(context: GuildSliceSourcesContext) {
  const guildSlices: readonly GuildSliceSource[] = [
    { domain: "moderation", fields: MODERATION_FIELDS, model: context.GuildModerationModel },
    { domain: "security", fields: SECURITY_FIELDS, model: context.GuildSecurityModel },
    { domain: "youtube", fields: YOUTUBE_FIELDS, model: context.GuildYoutubeStateModel }
  ];

  return {
    guildSlices,
    onSliceCopyMissing: (domain: string, guildId: string): void => {
      context.logger("WARN", "GUILD_SLICE", `Copia dedicata ${domain} lipsea pentru ${guildId}; se reface din documentul vechi`);
    },
    onSliceRepairFailed: (domain: string, guildId: string, error: unknown): void => {
      context.logger("ERROR", "GUILD_SLICE", `Copia dedicata ${domain} nu a putut fi refacuta pentru ${guildId}`, error);
    }
  };
}

function attachGuildSliceSources(target: GuildSliceSourcesContext): void {
  Object.assign(target, buildGuildSliceSourcesFrom(target));
}

attachGuildSliceSources.buildFrom = buildGuildSliceSourcesFrom;

export default attachGuildSliceSources;
