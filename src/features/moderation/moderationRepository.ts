"use strict";

export type ModerationRecord = {
  schemaVersion?: number;
  userId: string;
  username: string;
  moderatorId: string;
  appliedAt: Date;
  expiresAt?: Date | null;
  reason?: string;
};

export type WarningRecord = {
  schemaVersion?: number;
  warningId?: string;
  userId: string;
  username: string;
  moderatorId: string;
  warnedAt: Date;
};

type LeanQuery = { lean(): Promise<Record<string, unknown> | null> };

export type ModerationGuildModel = {
  findOne(filter: Record<string, unknown>): LeanQuery | Promise<Record<string, unknown> | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | readonly Record<string, unknown>[],
    options?: Record<string, unknown>
  ): LeanQuery | Promise<Record<string, unknown> | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | readonly Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<object | null | undefined>;
  updateMany?(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | readonly Record<string, unknown>[]
  ): Promise<object | null | undefined>;
};

export type GuildModerationState = {
  moderationTimeouts?: ModerationRecord[];
  moderationMutes?: ModerationRecord[];
  moderationWarnings?: WarningRecord[];
  moderationWarnBanLimit?: number;
};

function hasLean(value: unknown): value is LeanQuery {
  return Boolean(value && typeof value === "object" && "lean" in value && typeof value.lean === "function");
}

async function resolveDocument(value: LeanQuery | Promise<Record<string, unknown> | null>): Promise<Record<string, unknown> | null> {
  return hasLean(value) ? value.lean() : value;
}

async function readGuild(model: ModerationGuildModel, guildId: string): Promise<GuildModerationState> {
  return ((await resolveDocument(model.findOne({ _id: guildId }))) ?? {}) as GuildModerationState;
}

function moderationRecords(value: unknown): ModerationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record => record && typeof record === "object" && typeof (record as { userId?: unknown }).userId === "string") as ModerationRecord[];
}

function warningRecords(value: unknown): WarningRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record => record && typeof record === "object" && typeof (record as { userId?: unknown }).userId === "string") as WarningRecord[];
}

export async function cleanupExpiredModeration(model: ModerationGuildModel, now = new Date()): Promise<void> {
  if (!model.updateMany) return;
  await model.updateMany(
    {
      $or: [
        { "moderationTimeouts.expiresAt": { $lte: now } },
        { "moderationMutes.expiresAt": { $lte: now } }
      ]
    },
    {
      $pull: {
        moderationTimeouts: { expiresAt: { $ne: null, $lte: now } },
        moderationMutes: { expiresAt: { $ne: null, $lte: now } }
      }
    }
  );
}

async function cleanupGuild(model: ModerationGuildModel, guildId: string, now = new Date()): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    {
      $pull: {
        moderationTimeouts: { expiresAt: { $ne: null, $lte: now } },
        moderationMutes: { expiresAt: { $ne: null, $lte: now } }
      }
    }
  );
}

export async function getModerationState(model: ModerationGuildModel, guildId: string): Promise<GuildModerationState> {
  await cleanupGuild(model, guildId);
  const state = await readGuild(model, guildId);
  return {
    moderationTimeouts: moderationRecords(state.moderationTimeouts),
    moderationMutes: moderationRecords(state.moderationMutes),
    moderationWarnings: warningRecords(state.moderationWarnings),
    moderationWarnBanLimit: state.moderationWarnBanLimit ?? 0
  };
}

function saveRecordPipeline(
  targetField: "moderationTimeouts" | "moderationMutes",
  otherField: "moderationTimeouts" | "moderationMutes",
  record: ModerationRecord
): readonly Record<string, unknown>[] {
  return [{
    $set: {
      [targetField]: {
        $concatArrays: [
          {
            $filter: {
              input: { $ifNull: [`$${targetField}`, []] },
              as: "entry",
              cond: { $ne: ["$$entry.userId", record.userId] }
            }
          },
          [record]
        ]
      },
      [otherField]: {
        $filter: {
          input: { $ifNull: [`$${otherField}`, []] },
          as: "entry",
          cond: { $ne: ["$$entry.userId", record.userId] }
        }
      }
    }
  }];
}

export async function saveTimeout(model: ModerationGuildModel, guildId: string, record: ModerationRecord): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    saveRecordPipeline("moderationTimeouts", "moderationMutes", record),
    { upsert: true }
  );
}

export async function saveMute(model: ModerationGuildModel, guildId: string, record: ModerationRecord): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    saveRecordPipeline("moderationMutes", "moderationTimeouts", record),
    { upsert: true }
  );
}

export async function findModerationRecord(
  model: ModerationGuildModel,
  guildId: string,
  field: "moderationTimeouts" | "moderationMutes",
  userId: string
): Promise<ModerationRecord | null> {
  const state = await getModerationState(model, guildId);
  return moderationRecords(state[field]).find(record => record.userId === userId) ?? null;
}

export async function findModerationRecordsForUser(
  model: ModerationGuildModel,
  guildId: string,
  userId: string
): Promise<{ timeout: ModerationRecord | null; mute: ModerationRecord | null }> {
  const state = await getModerationState(model, guildId);
  return {
    timeout: moderationRecords(state.moderationTimeouts).find(record => record.userId === userId) ?? null,
    mute: moderationRecords(state.moderationMutes).find(record => record.userId === userId) ?? null
  };
}

export async function removeModeration(
  model: ModerationGuildModel,
  guildId: string,
  field: "moderationTimeouts" | "moderationMutes",
  userId: string
): Promise<boolean> {
  const document = await resolveDocument(model.findOneAndUpdate(
    { _id: guildId, [`${field}.userId`]: userId },
    { $pull: { [field]: { userId } } },
    { returnDocument: "after" }
  ));
  return document !== null;
}

export async function removeAllModerationForUser(model: ModerationGuildModel, guildId: string, userId: string): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    {
      $pull: {
        moderationTimeouts: { userId },
        moderationMutes: { userId }
      }
    }
  );
}

export type MemberTimeoutState = { userId: string; communicationDisabledUntil?: Date | string | number | null };

export function reconcileTimeoutRecords(
  records: readonly ModerationRecord[],
  members: readonly MemberTimeoutState[],
  now: number
): { staleUserIds: string[] } {
  const activeInDiscord = new Set<string>();
  for (const member of members) {
    if (!member?.userId) continue;
    const until = member.communicationDisabledUntil != null ? new Date(member.communicationDisabledUntil).getTime() : 0;
    if (Number.isFinite(until) && until > now) activeInDiscord.add(member.userId);
  }
  const stale = new Set<string>();
  for (const record of moderationRecords(records)) {
    const expiresAt = record.expiresAt != null ? new Date(record.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    const botConsidersActive = !Number.isFinite(expiresAt) || expiresAt > now;
    if (botConsidersActive && !activeInDiscord.has(record.userId)) stale.add(record.userId);
  }
  return { staleUserIds: [...stale] };
}

export async function pullStaleTimeouts(model: ModerationGuildModel, guildId: string, userIds: readonly string[]): Promise<number> {
  const unique = [...new Set(userIds.filter(id => typeof id === "string" && id.length > 0))];
  if (!unique.length) return 0;
  await model.updateOne(
    { _id: guildId },
    { $pull: { moderationTimeouts: { userId: { $in: unique } } } }
  );
  return unique.length;
}

export async function pullModerationRecords(
  model: ModerationGuildModel,
  guildId: string,
  timeoutUserIds: readonly string[],
  muteUserIds: readonly string[]
): Promise<number> {
  const timeoutIds = [...new Set(timeoutUserIds.filter(id => id.length > 0))];
  const muteIds = [...new Set(muteUserIds.filter(id => id.length > 0))];
  if (timeoutIds.length === 0 && muteIds.length === 0) return 0;
  const pull: Record<string, object> = {};
  if (timeoutIds.length > 0) pull.moderationTimeouts = { userId: { $in: timeoutIds } };
  if (muteIds.length > 0) pull.moderationMutes = { userId: { $in: muteIds } };
  await model.updateOne({ _id: guildId }, { $pull: pull });
  return timeoutIds.length + muteIds.length;
}

export const MAX_WARN_HISTORY = 500;

export async function addWarning(model: ModerationGuildModel, guildId: string, record: WarningRecord): Promise<{ count: number; limit: number }> {
  const document = await resolveDocument(model.findOneAndUpdate(
    { _id: guildId },
    [{
      $set: {
        moderationWarnings: {
          $slice: [
            { $concatArrays: [{ $ifNull: ["$moderationWarnings", []] }, [record]] },
            -MAX_WARN_HISTORY
          ]
        },
        moderationWarnBanLimit: { $ifNull: ["$moderationWarnBanLimit", 0] }
      }
    }],
    { upsert: true, returnDocument: "after" }
  ));
  const warnings = warningRecords(document?.moderationWarnings);
  const limit = typeof document?.moderationWarnBanLimit === "number" ? document.moderationWarnBanLimit : 0;
  return { count: warnings.filter(item => item.userId === record.userId).length, limit };
}

export async function removeWarning(
  model: ModerationGuildModel,
  guildId: string,
  userId: string
): Promise<{ removed: boolean; remaining: number }> {
  const document = await resolveDocument(model.findOneAndUpdate(
    { _id: guildId, "moderationWarnings.userId": userId },
    [{
      $set: {
        moderationWarnings: {
          $let: {
            vars: { reversed: { $reverseArray: { $ifNull: ["$moderationWarnings", []] } } },
            in: {
              $let: {
                vars: {
                  index: {
                    $indexOfArray: [
                      { $map: { input: "$$reversed", as: "entry", in: "$$entry.userId" } },
                      userId
                    ]
                  }
                },
                in: {
                  $reverseArray: {
                    $concatArrays: [
                      { $slice: ["$$reversed", 0, "$$index"] },
                      {
                        $slice: [
                          "$$reversed",
                          { $add: ["$$index", 1] },
                          { $size: "$$reversed" }
                        ]
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    }],
    { returnDocument: "after" }
  ));
  if (!document) return { removed: false, remaining: 0 };
  return {
    removed: true,
    remaining: warningRecords(document.moderationWarnings).filter(item => item.userId === userId).length
  };
}

export async function removeWarningById(
  model: ModerationGuildModel,
  guildId: string,
  warningId: string
): Promise<boolean> {
  const document = await resolveDocument(model.findOneAndUpdate(
    { _id: guildId, "moderationWarnings.warningId": warningId },
    { $pull: { moderationWarnings: { warningId } } },
    { returnDocument: "after" }
  ));
  return document !== null;
}

export async function setWarnBanLimit(model: ModerationGuildModel, guildId: string, limit: number): Promise<number> {
  const previous = await resolveDocument(model.findOneAndUpdate(
    { _id: guildId },
    { $set: { moderationWarnBanLimit: limit } },
    { upsert: true, returnDocument: "before" }
  ));
  return typeof previous?.moderationWarnBanLimit === "number" ? previous.moderationWarnBanLimit : 0;
}

export async function setWarningChannel(model: ModerationGuildModel, guildId: string, channelId: string): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    { $set: { warningChannelId: channelId } },
    { upsert: true }
  );
}

export default {
  getModerationState,
  cleanupExpiredModeration,
  saveTimeout,
  saveMute,
  findModerationRecord,
  findModerationRecordsForUser,
  removeModeration,
  removeAllModerationForUser,
  reconcileTimeoutRecords,
  pullStaleTimeouts,
  pullModerationRecords,
  addWarning,
  removeWarning,
  removeWarningById,
  setWarnBanLimit,
  setWarningChannel
};
