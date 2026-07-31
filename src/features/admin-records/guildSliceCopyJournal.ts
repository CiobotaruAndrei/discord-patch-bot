import { createOperationJournal } from "../../shared/operationJournalEngine.js";
import { GUILD_SLICE_COPY_KIND, OPERATION_PAYLOAD_SCHEMA_VERSION, decodeSliceUpdate, guildSliceCopyPayload } from "./operationJournalRuntime.js";

import type { OperationJournalModelLike } from "../../shared/operationJournalEngine.js";
import type { GuildSliceCopyModelLike, GuildSliceCopyPayload } from "./operationJournalRuntime.js";
import type { SliceCopyWriter, SliceUpdate } from "../../shared/guildDomainSliceStore.js";

type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface GuildSliceCopyJournalDeps {
  OperationJournalModel: OperationJournalModelLike;
  domain: string;
  dedicatedModel: GuildSliceCopyModelLike;
  logger: JournalLogger;
}

let sequence = 0;

function copyKey(domain: string, guildId: string): string {
  sequence += 1;
  return `${GUILD_SLICE_COPY_KIND}:${domain}:${guildId}:${Date.now()}:${sequence}`;
}

export function createGuildSliceCopyJournal(deps: GuildSliceCopyJournalDeps): SliceCopyWriter {
  const journal = createOperationJournal<{ [GUILD_SLICE_COPY_KIND]: GuildSliceCopyPayload }>({
    JournalModel: deps.OperationJournalModel,
    logger: deps.logger,
    executors: {
      [GUILD_SLICE_COPY_KIND]: async (value: unknown) => {
        const payload = guildSliceCopyPayload(value);
        if (!payload) throw new Error("guildSliceCopyJournal: payload invalid pentru copia feliei");
        await deps.dedicatedModel.updateOne({ _id: payload.guildId }, decodeSliceUpdate(payload.update), { upsert: true });
      }
    },
    schemaVersions: { [GUILD_SLICE_COPY_KIND]: OPERATION_PAYLOAD_SCHEMA_VERSION }
  });

  return async function copySlice(guildId: string, update: SliceUpdate): Promise<void> {
    await journal.runJournaled(copyKey(deps.domain, guildId), GUILD_SLICE_COPY_KIND, {
      guildId,
      domain: deps.domain,
      update: JSON.stringify(update)
    });
  };
}
