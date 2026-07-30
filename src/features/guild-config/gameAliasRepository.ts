"use strict";

import type { GuildSettings } from "./guildSettingsTypes.js";
import { MAX_ALIASES_PER_GAME, MAX_TOTAL_GAME_ALIASES, gameAliasRecord } from "./gameAliasService.js";
import { updatedDocument } from "../../shared/persistenceOutcome.js";

export interface GameAliasGuildModelLike {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ gameAliases?: GuildSettings["gameAliases"] } | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ matchedCount?: number; modifiedCount?: number }>;
}

export function buildAddGameAliasPipeline(gameKey: string, alias: string): Array<Record<string, unknown>> {
  const field = `gameAliases.${gameKey}`;
  return [{
    $set: {
      [field]: {
        $let: {
          vars: {
            existing: { $ifNull: [`$${field}`, []] },
            total: {
              $reduce: {
                input: { $objectToArray: { $ifNull: ["$gameAliases", {}] } },
                initialValue: 0,
                in: { $add: ["$$value", { $size: { $ifNull: ["$$this.v", []] } }] }
              }
            }
          },
          in: {
            $cond: [
              {
                $and: [
                  { $not: [{ $in: [alias, "$$existing"] }] },
                  { $lt: [{ $size: "$$existing" }, MAX_ALIASES_PER_GAME] },
                  { $lt: ["$$total", MAX_TOTAL_GAME_ALIASES] }
                ]
              },
              { $concatArrays: ["$$existing", [alias]] },
              "$$existing"
            ]
          }
        }
      }
    }
  }];
}

export async function addGameAlias(
  GuildModel: GameAliasGuildModelLike,
  guildId: string,
  gameKey: string,
  alias: string
): Promise<{ saved: boolean }> {
  const updated = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildAddGameAliasPipeline(gameKey, alias),
    { upsert: true, returnDocument: "after", updatePipeline: true }
  );
  const record = gameAliasRecord(updated?.gameAliases);
  return { saved: (record[gameKey] || []).includes(alias) };
}

export async function removeGameAlias(
  GuildModel: GameAliasGuildModelLike,
  guildId: string,
  gameKey: string,
  alias: string
): Promise<{ removed: boolean }> {
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { [`gameAliases.${gameKey}`]: alias } }
  );
  return { removed: updatedDocument(result) };
}
