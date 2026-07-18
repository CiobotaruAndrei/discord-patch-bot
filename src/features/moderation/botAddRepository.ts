"use strict";

export type BotAddPermissionStatus = "pending" | "approved" | "used" | "rejected" | "expired" | "cancelled";

export interface BotAddPermissionRecord {
  schemaVersion?: number;
  requestId: string;
  botId: string;
  requesterId: string;
  requestedAt: Date;
  ownerId?: string | null;
  respondedAt?: Date | null;
  expiresAt?: Date | null;
  usedAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: "protection-stopped" | null;
  status: BotAddPermissionStatus;
}

export interface BotAddState {
  botAddPermissions: BotAddPermissionRecord[];
}

interface LeanQuery {
  lean(): Promise<Record<string, unknown> | null>;
}

interface GuildModelLike {
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
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const APPROVED_TTL_MS = 30 * 60 * 1000;

function hasLean(value: unknown): value is LeanQuery {
  return Boolean(value && typeof value === "object" && "lean" in value && typeof value.lean === "function");
}

async function resolveDocument(value: LeanQuery | Promise<Record<string, unknown> | null>): Promise<Record<string, unknown> | null> {
  return hasLean(value) ? value.lean() : value;
}

async function readGuild(model: GuildModelLike, guildId: string): Promise<Record<string, unknown>> {
  return (await resolveDocument(model.findOne({ _id: guildId }))) ?? {};
}

function asRecords(value: unknown): BotAddPermissionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === "object"
    && typeof (item as { requestId?: unknown }).requestId === "string"
    && typeof (item as { botId?: unknown }).botId === "string"
    && typeof (item as { requesterId?: unknown }).requesterId === "string") as BotAddPermissionRecord[];
}

function findRecord(document: Record<string, unknown> | null, predicate: (record: BotAddPermissionRecord) => boolean): BotAddPermissionRecord | null {
  return asRecords(document?.botAddPermissions).find(predicate) ?? null;
}

async function expirePermissions(model: GuildModelLike, guildId: string, now: Date): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    {
      $set: {
        "botAddPermissions.$[entry].status": "expired",
        "botAddPermissions.$[entry].respondedAt": now
      }
    },
    {
      arrayFilters: [{
        "entry.status": { $in: ["pending", "approved"] },
        "entry.expiresAt": { $ne: null, $lte: now }
      }]
    }
  );
}

export async function getBotAddState(model: GuildModelLike, guildId: string, now = new Date()): Promise<BotAddState> {
  await expirePermissions(model, guildId, now);
  const document = await readGuild(model, guildId);
  return { botAddPermissions: asRecords(document.botAddPermissions) };
}

export async function createBotAddRequest(
  model: GuildModelLike,
  guildId: string,
  request: Omit<BotAddPermissionRecord, "status" | "respondedAt" | "ownerId" | "expiresAt" | "usedAt">,
  now = new Date()
): Promise<BotAddPermissionRecord> {
  await expirePermissions(model, guildId, now);
  const record: BotAddPermissionRecord = {
    ...request,
    requestedAt: new Date(request.requestedAt),
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    status: "pending"
  };
  try {
    const document = await resolveDocument(model.findOneAndUpdate(
      {
        _id: guildId,
        botAddPermissions: {
          $not: {
            $elemMatch: {
              botId: request.botId,
              requesterId: request.requesterId,
              status: "pending",
              expiresAt: { $gt: now }
            }
          }
        }
      },
      {
        $setOnInsert: { _id: guildId },
        $push: { botAddPermissions: record }
      },
      { upsert: true, returnDocument: "after" }
    ));
    return findRecord(document, entry => entry.requestId === record.requestId) ?? record;
  } catch {
    const existing = findRecord(await readGuild(model, guildId), entry =>
      entry.botId === request.botId
      && entry.requesterId === request.requesterId
      && entry.status === "pending"
      && Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() > now.getTime())
    );
    if (existing) return existing;
    throw new Error("Solicitarea bot-add nu a putut fi salvata atomic.");
  }
}

export async function cancelUndeliveredBotAddRequest(
  model: GuildModelLike,
  guildId: string,
  requestId: string
): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    { $pull: { botAddPermissions: { requestId, status: "pending" } } }
  );
}

export async function resolveBotAddRequest(
  model: GuildModelLike,
  guildId: string,
  requestId: string,
  decision: "approved" | "rejected",
  ownerId: string,
  now = new Date()
): Promise<BotAddPermissionRecord | null> {
  await expirePermissions(model, guildId, now);
  const expiresAt = decision === "approved" ? new Date(now.getTime() + APPROVED_TTL_MS) : null;
  const document = await resolveDocument(model.findOneAndUpdate(
    {
      _id: guildId,
      botAddPermissions: {
        $elemMatch: {
          requestId,
          status: "pending",
          expiresAt: { $gt: now }
        }
      }
    },
    {
      $set: {
        "botAddPermissions.$[entry].ownerId": ownerId,
        "botAddPermissions.$[entry].respondedAt": now,
        "botAddPermissions.$[entry].status": decision,
        "botAddPermissions.$[entry].expiresAt": expiresAt
      }
    },
    {
      arrayFilters: [{
        "entry.requestId": requestId,
        "entry.status": "pending",
        "entry.expiresAt": { $gt: now }
      }],
      returnDocument: "after"
    }
  ));
  return findRecord(document, entry => entry.requestId === requestId && entry.status === decision);
}

export async function consumeBotAddPermission(
  model: GuildModelLike,
  guildId: string,
  botId: string,
  requesterId: string,
  now = new Date()
): Promise<BotAddPermissionRecord | null> {
  await expirePermissions(model, guildId, now);
  const document = await resolveDocument(model.findOneAndUpdate(
    {
      _id: guildId,
      botAddPermissions: {
        $elemMatch: {
          botId,
          requesterId,
          status: "approved",
          expiresAt: { $gt: now }
        }
      }
    },
    {
      $set: {
        "botAddPermissions.$[entry].status": "used",
        "botAddPermissions.$[entry].usedAt": now
      }
    },
    {
      arrayFilters: [{
        "entry.botId": botId,
        "entry.requesterId": requesterId,
        "entry.status": "approved",
        "entry.expiresAt": { $gt: now }
      }],
      returnDocument: "after"
    }
  ));
  return findRecord(document, entry =>
    entry.botId === botId
    && entry.requesterId === requesterId
    && entry.status === "used"
    && Boolean(entry.usedAt && new Date(entry.usedAt).getTime() === now.getTime())
  );
}

export interface BotAddCancelModelLike {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown> | readonly Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<unknown>;
}

export function countActiveBotAddPermissions(records: unknown, now = new Date()): number {
  return asRecords(records).filter(entry =>
    (entry.status === "pending" || entry.status === "approved")
    && Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() > now.getTime())
  ).length;
}

export async function stopBotAddProtectionAtomically(model: BotAddCancelModelLike, guildId: string, now = new Date()): Promise<void> {
  await model.updateOne(
    { _id: guildId },
    [{
      $set: {
        botAddProtectionEnabled: false,
        botAddPermissions: {
          $map: {
            input: { $ifNull: ["$botAddPermissions", []] },
            as: "entry",
            in: {
              $cond: [
                {
                  $and: [
                    { $in: ["$$entry.status", ["pending", "approved"]] },
                    { $gt: ["$$entry.expiresAt", now] }
                  ]
                },
                {
                  $mergeObjects: [
                    "$$entry",
                    {
                      status: "cancelled",
                      respondedAt: now,
                      cancelledAt: now,
                      cancellationReason: "protection-stopped"
                    }
                  ]
                },
                "$$entry"
              ]
            }
          }
        }
      }
    }]
  );
}

export default { getBotAddState, createBotAddRequest, cancelUndeliveredBotAddRequest, resolveBotAddRequest, consumeBotAddPermission, countActiveBotAddPermissions, stopBotAddProtectionAtomically };
