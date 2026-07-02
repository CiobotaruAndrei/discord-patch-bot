"use strict";

import type { GuildSettings, SuggestedCommandEntry } from "../../types";

type MongoWriteResult = { modifiedCount?: number; matchedCount?: number };

type GuildModelLike = {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
};

type SuggestedCommandGuildModel = GuildModelLike & {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<{ suggestedCommands?: SuggestedCommandEntry[] } | null>;
};

const MAX_SUGGESTED_COMMANDS = 100;

export function buildSuggestedCommandUpsertPipeline(record: SuggestedCommandEntry, maxItems: number): Array<Record<string, unknown>> {
  return [{
    $set: {
      suggestedCommands: {
        $let: {
          vars: { existing: { $ifNull: ["$suggestedCommands", []] } },
          in: {
            $cond: [
              { $in: [record.commandName, { $map: { input: "$$existing", as: "entry", in: "$$entry.commandName" } }] },
              "$$existing",
              { $slice: [{ $concatArrays: ["$$existing", [record]] }, -maxItems] }
            ]
          }
        }
      }
    }
  }];
}

export async function saveSuggestedCommand(
  GuildModel: SuggestedCommandGuildModel,
  guildId: string,
  entry: Omit<SuggestedCommandEntry, "createdAt">
): Promise<{ record: SuggestedCommandEntry; added: boolean }> {
  const record: SuggestedCommandEntry = {
    ...entry,
    createdAt: new Date()
  };
  const before = await GuildModel.findOneAndUpdate(
    { _id: guildId },
    buildSuggestedCommandUpsertPipeline(record, MAX_SUGGESTED_COMMANDS),
    { upsert: true }
  );
  const existed = (Array.isArray(before?.suggestedCommands) ? before.suggestedCommands : [])
    .some(entryItem => entryItem.commandName === record.commandName);
  return { record, added: !existed };
}

export function listSuggestedCommands(settings: GuildSettings | null, limit: number): SuggestedCommandEntry[] {
  const entries = Array.isArray(settings?.suggestedCommands) ? settings.suggestedCommands : [];
  return [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export async function deleteSuggestedCommand(GuildModel: GuildModelLike, guildId: string, name: string): Promise<boolean> {
  const normalized = name.trim().replace(/^\/+/, "").replace(/\s+/g, " ").toLowerCase();
  const result = await GuildModel.updateOne(
    { _id: guildId },
    { $pull: { suggestedCommands: { commandName: normalized } } }
  );
  return (result.modifiedCount ?? 0) > 0;
}
