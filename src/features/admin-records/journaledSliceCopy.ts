import { createGuildSliceCopyJournal } from "./guildSliceCopyJournal.js";

import type { OperationJournalModelLike } from "../../shared/operationJournalEngine.js";
import type { GuildSliceCopyModelLike } from "./operationJournalRuntime.js";
import type { SliceCopyWriter } from "../../shared/guildDomainSliceStore.js";

type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface OptionalSliceCopyJournalDeps {
  OperationJournalModel?: OperationJournalModelLike;
  domain: string;
  dedicatedModel: GuildSliceCopyModelLike;
  logger?: JournalLogger;
}

export function journaledSliceCopy(deps: OptionalSliceCopyJournalDeps): SliceCopyWriter | undefined {
  if (!deps.OperationJournalModel) return undefined;
  return createGuildSliceCopyJournal({
    OperationJournalModel: deps.OperationJournalModel,
    domain: deps.domain,
    dedicatedModel: deps.dedicatedModel,
    logger: deps.logger ?? (() => undefined)
  });
}
