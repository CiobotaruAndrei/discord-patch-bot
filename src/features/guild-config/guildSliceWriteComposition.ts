"use strict";

import { createGuildSliceWriteModel } from "./guildSliceWriteModel.js";
import { journaledSliceCopy } from "../admin-records/journaledSliceCopy.js";
import { MODERATION_FIELDS } from "../../shared/guildModerationFields.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";
import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";

import type { OperationJournalModelLike } from "../../shared/operationJournalEngine.js";
import type { GuildConfigWriteModelLike } from "./guildConfigRepository.js";
import type { GuildSliceTarget } from "./guildSliceWriteModel.js";

type SliceModel = NonNullable<GuildSliceTarget["model"]>;
type SliceLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface GuildSliceWriteCompositionDeps {
  GuildModel: GuildConfigWriteModelLike;
  GuildModerationModel?: SliceModel;
  GuildSecurityModel?: SliceModel;
  GuildYoutubeStateModel?: SliceModel;
  OperationJournalModel?: OperationJournalModelLike;
  logger?: SliceLogger;
}

export function composeGuildSliceWriteModel(deps: GuildSliceWriteCompositionDeps): GuildConfigWriteModelLike {
  const declared: Array<[string, readonly string[], SliceModel | undefined]> = [
    ["moderation", MODERATION_FIELDS, deps.GuildModerationModel],
    ["security", SECURITY_FIELDS, deps.GuildSecurityModel],
    ["youtube", YOUTUBE_FIELDS, deps.GuildYoutubeStateModel]
  ];
  const slices: GuildSliceTarget[] = [];
  for (const [domain, fields, model] of declared) {
    if (!model) continue;
    slices.push({
      domain,
      fields,
      model,
      journaledCopy: journaledSliceCopy({
        OperationJournalModel: deps.OperationJournalModel,
        domain,
        dedicatedModel: model,
        logger: deps.logger
      })
    });
  }
  if (slices.length === 0) return deps.GuildModel;
  return createGuildSliceWriteModel(deps.GuildModel, slices, {
    onCopyFailed: (domain, guildId, error) => {
      deps.logger?.("ERROR", "GUILD_SLICE", `Copia dedicata ${domain} nu a putut fi actualizata pentru ${guildId}`, error);
    }
  });
}
