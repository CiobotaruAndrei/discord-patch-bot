export type BotAddPermissionStatus = "pending" | "approved" | "used" | "rejected" | "expired" | "cancelled";

export interface BotAddPermissionRecord {
  requestId: string;
  botId: string;
  requesterId: string;
  requestedAt: Date;
  ownerId?: string | null;
  respondedAt?: Date | null;
  expiresAt?: Date | null;
  usedAt?: Date | null;
  status: BotAddPermissionStatus;
}

export interface BotAddState {
  botAddPermissions: BotAddPermissionRecord[];
}

interface GuildModelLike {
  findOne(filter: { _id: string }): { lean(): Promise<Record<string, unknown> | null> } | Promise<Record<string, unknown> | null>;
  updateOne(filter: { _id: string }, update: Record<string, unknown>, options?: { upsert?: boolean }): Promise<unknown>;
}

function hasLean(value: unknown): value is { lean(): Promise<Record<string, unknown> | null> } {
  return Boolean(value && typeof (value as { lean?: unknown }).lean === "function");
}

async function readGuild(model: GuildModelLike, guildId: string): Promise<Record<string, unknown>> {
  const result = model.findOne({ _id: guildId });
  return (hasLean(result) ? await result.lean() : await result) ?? {};
}

function asRecords(value: unknown): BotAddPermissionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === "object" && typeof (item as { botId?: unknown }).botId === "string") as BotAddPermissionRecord[];
}

function normalize(records: BotAddPermissionRecord[], now: Date): BotAddPermissionRecord[] {
  const nowMs = now.getTime();
  return records.map(record => {
    if (record.status === "pending" && record.expiresAt && new Date(record.expiresAt).getTime() <= nowMs) {
      return { ...record, status: "expired" as const };
    }
    if (record.status === "approved" && record.expiresAt && new Date(record.expiresAt).getTime() <= nowMs) {
      return { ...record, status: "expired" as const };
    }
    return record;
  });
}

export async function getBotAddState(model: GuildModelLike, guildId: string, now = new Date()): Promise<BotAddState> {
  const document = await readGuild(model, guildId);
  const records = normalize(asRecords(document.botAddPermissions), now);
  if (records.some((record, index) => record.status !== asRecords(document.botAddPermissions)[index]?.status)) {
    await model.updateOne({ _id: guildId }, { $set: { botAddPermissions: records } }, { upsert: true });
  }
  return { botAddPermissions: records };
}

export async function createBotAddRequest(
  model: GuildModelLike,
  guildId: string,
  request: Omit<BotAddPermissionRecord, "status" | "respondedAt" | "ownerId" | "expiresAt" | "usedAt">,
  now = new Date()
): Promise<BotAddPermissionRecord> {
  const state = await getBotAddState(model, guildId, now);
  const existing = state.botAddPermissions.find(record => record.botId === request.botId && record.requesterId === request.requesterId && record.status === "pending");
  if (existing) return existing;
  const record: BotAddPermissionRecord = { ...request, requestedAt: new Date(request.requestedAt), status: "pending" };
  await model.updateOne({ _id: guildId }, { $set: { botAddPermissions: [...state.botAddPermissions, record] } }, { upsert: true });
  return record;
}

export async function resolveBotAddRequest(
  model: GuildModelLike,
  guildId: string,
  requestId: string,
  decision: "approved" | "rejected",
  ownerId: string,
  now = new Date()
): Promise<BotAddPermissionRecord | null> {
  const state = await getBotAddState(model, guildId, now);
  const index = state.botAddPermissions.findIndex(record => record.requestId === requestId && record.status === "pending");
  if (index < 0) return null;
  const previous = state.botAddPermissions[index];
  const updated: BotAddPermissionRecord = {
    ...previous,
    ownerId,
    respondedAt: now,
    status: decision,
    expiresAt: decision === "approved" ? new Date(now.getTime() + 30 * 60 * 1000) : null
  };
  const records = [...state.botAddPermissions];
  records[index] = updated;
  await model.updateOne({ _id: guildId }, { $set: { botAddPermissions: records } }, { upsert: true });
  return updated;
}

export async function consumeBotAddPermission(
  model: GuildModelLike,
  guildId: string,
  botId: string,
  requesterId: string,
  now = new Date()
): Promise<BotAddPermissionRecord | null> {
  const state = await getBotAddState(model, guildId, now);
  const index = state.botAddPermissions.findIndex(record => record.botId === botId && record.requesterId === requesterId && record.status === "approved");
  if (index < 0) return null;
  const updated = { ...state.botAddPermissions[index], status: "used" as const, usedAt: now };
  const records = [...state.botAddPermissions];
  records[index] = updated;
  await model.updateOne({ _id: guildId }, { $set: { botAddPermissions: records } }, { upsert: true });
  return updated;
}

export default { getBotAddState, createBotAddRequest, resolveBotAddRequest, consumeBotAddPermission };
