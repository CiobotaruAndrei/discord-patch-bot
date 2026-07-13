"use strict";

import type { MongoWriteOutcome } from "../../types.js";
import type { DeadLetterEntry } from "./deadLetter.js";
import { recordDeadLetters, type DeadLetterModelLike } from "./deadLetterRepository.js";

export interface CycleGuildModelLike {
  updateOne(filter: Record<string, unknown>, update: unknown): Promise<MongoWriteOutcome>;
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
  if (deadLettered.length && (writeResult.matchedCount ?? 0) > 0) {
    await recordDeadLetters(GuildDeadLetterModel, guildId, deadLettered);
  }
}
