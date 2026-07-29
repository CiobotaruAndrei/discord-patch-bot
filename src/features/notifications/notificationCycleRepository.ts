"use strict";

import type { MongoWriteOutcome } from "../../types.js";
type MongoUpdate = Record<string, unknown>;
import type { DeadLetterEntry } from "./deadLetter.js";
import { recordDeadLetters, type DeadLetterModelLike } from "./deadLetterRepository.js";
import { matchedDocument } from "../../shared/persistenceOutcome.js";

export interface CycleGuildModelLike {
  updateOne(filter: Record<string, unknown>, update: MongoUpdate): Promise<MongoWriteOutcome>;
}

export async function persistGuildCycleState(
  GuildModel: CycleGuildModelLike,
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "insertMany" | "find" | "deleteMany">,
  guildId: string,
  subscriptionFilter: Record<string, unknown>,
  set: Record<string, unknown>,
  deadLettered: DeadLetterEntry[]
): Promise<void> {
  const writeResult = await GuildModel.updateOne(subscriptionFilter, { $set: set });
  if (deadLettered.length && matchedDocument(writeResult)) {
    await recordDeadLetters(GuildDeadLetterModel, guildId, deadLettered);
  }
}
