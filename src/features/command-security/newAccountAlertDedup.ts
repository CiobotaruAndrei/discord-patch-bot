"use strict";

export interface NewAccountSeenModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ upsertedCount?: number; upsertedId?: unknown }>;
}

export function createNewAccountAlertDedup(
  model: NewAccountSeenModelLike,
  now: () => number = () => Date.now()
): (guildId: string, userId: string) => Promise<boolean> {
  return async function markNewAccountAlerted(guildId: string, userId: string): Promise<boolean> {
    if (!guildId || !userId) return false;
    try {
      const result = await model.updateOne(
        { guildId, userId },
        { $setOnInsert: { guildId, userId, alertedAt: new Date(now()) } },
        { upsert: true }
      );
      return (result.upsertedCount ?? 0) > 0 || result.upsertedId != null;
    } catch {
      return true;
    }
  };
}

export default { createNewAccountAlertDedup };
