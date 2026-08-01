"use strict";

import { createdDocument, updatedDocument } from "../../shared/persistenceOutcome.js";
import { canAdvance, newIncidentId } from "./antiRaidIncidentTypes.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type {
  LockedChannel,
  RaidIncidentRecord,
  RaidParticipant,
  RaidStage,
  SanctionStep
} from "./antiRaidIncidentTypes.js";

export const PARTICIPANT_LIMIT = 500;

export interface RaidIncidentModelLike {
  findOne(filter: Record<string, unknown>, projection?: Record<string, unknown>): {
    sort(spec: unknown): { lean(): Promise<Record<string, unknown> | null> };
    lean(): Promise<Record<string, unknown> | null>;
  };
  find(filter: Record<string, unknown>, projection?: Record<string, unknown>): {
    sort(spec: unknown): { limit(count: number): { lean(): Promise<Array<Record<string, unknown>>> } };
  };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<WriteCounts | null | undefined>;
}

function asRecord(document: Record<string, unknown> | null): RaidIncidentRecord | null {
  if (!document) return null;
  const record = document as Record<string, unknown> & RaidIncidentRecord;
  return {
    ...record,
    participants: record.participants ?? [],
    lockedChannels: record.lockedChannels ?? [],
    pendingActions: record.pendingActions ?? [],
    errors: record.errors ?? []
  };
}

export interface OpenIncidentInput {
  guildId: string;
  triggerReason: string;
  manual?: boolean;
  dryRun?: boolean;
  stage?: RaidStage;
}

export function createRaidIncidentRepository(model: RaidIncidentModelLike) {
  async function active(guildId: string): Promise<RaidIncidentRecord | null> {
    return asRecord(await model.findOne({ guildId, stage: { $ne: "resolved" } }).sort({ startedAt: -1 }).lean());
  }

  async function read(incidentId: string): Promise<RaidIncidentRecord | null> {
    return asRecord(await model.findOne({ _id: incidentId }).lean());
  }

  async function latest(guildId: string): Promise<RaidIncidentRecord | null> {
    return asRecord(await model.findOne({ guildId }).sort({ startedAt: -1 }).lean());
  }

  async function history(guildId: string, limit = 20): Promise<RaidIncidentRecord[]> {
    const documents = await model.find({ guildId }).sort({ startedAt: -1 }).limit(limit).lean();
    return documents.map(document => asRecord(document)).filter((record): record is RaidIncidentRecord => record !== null);
  }

  async function open(input: OpenIncidentInput, now = new Date(), random?: () => number): Promise<RaidIncidentRecord | null> {
    const existing = await active(input.guildId);
    if (existing) return null;

    const record: RaidIncidentRecord = {
      _id: newIncidentId(now.getTime(), random),
      guildId: input.guildId,
      stage: input.stage ?? "suspected",
      startedAt: now,
      confirmedAt: input.stage && input.stage !== "suspected" ? now : null,
      resolvedAt: null,
      lastActivityAt: now,
      triggerReason: input.triggerReason,
      manual: input.manual === true,
      dryRun: input.dryRun === true,
      participants: [],
      lockedChannels: [],
      pendingActions: [],
      errors: [],
      restoreProgress: 0
    };
    const result = await model.updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    return createdDocument(result) ? record : null;
  }

  async function advance(incidentId: string, from: RaidStage, to: RaidStage, now = new Date()): Promise<boolean> {
    if (!canAdvance(from, to)) return false;
    const set: Record<string, unknown> = { stage: to, lastActivityAt: now };
    if (to === "confirmed") set.confirmedAt = now;
    if (to === "resolved") set.resolvedAt = now;
    return updatedDocument(await model.updateOne({ _id: incidentId, stage: from }, { $set: set }));
  }

  async function touch(incidentId: string, now = new Date()): Promise<boolean> {
    return updatedDocument(await model.updateOne({ _id: incidentId }, { $set: { lastActivityAt: now } }));
  }

  async function addParticipant(
    incidentId: string,
    userId: string,
    bot: boolean,
    now = new Date()
  ): Promise<boolean> {
    const participant: RaidParticipant = {
      userId,
      bot,
      confirmedAt: now,
      state: "pending",
      appliedSteps: [],
      failedSteps: [],
      lastError: null
    };
    const result = await model.updateOne(
      { _id: incidentId, "participants.userId": { $ne: userId }, [`participants.${PARTICIPANT_LIMIT - 1}`]: { $exists: false } },
      { $push: { participants: participant }, $set: { lastActivityAt: now } }
    );
    return updatedDocument(result);
  }

  async function removeParticipant(incidentId: string, userId: string, now = new Date()): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId },
      { $pull: { participants: { userId } }, $set: { lastActivityAt: now } }
    );
    return updatedDocument(result);
  }

  async function recordSanction(
    incidentId: string,
    userId: string,
    step: SanctionStep,
    succeeded: boolean,
    error: string | null,
    now = new Date()
  ): Promise<boolean> {
    const listField = succeeded ? "appliedSteps" : "failedSteps";
    const set: Record<string, unknown> = { lastActivityAt: now, "participants.$.lastError": error };
    if (succeeded) set["participants.$.state"] = "stopped";
    const result = await model.updateOne(
      { _id: incidentId, participants: { $elemMatch: { userId, [listField]: { $ne: step } } } },
      { $push: { [`participants.$.${listField}`]: step }, $set: set }
    );
    return updatedDocument(result);
  }

  async function markParticipantFailed(incidentId: string, userId: string, error: string, now = new Date()): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId, participants: { $elemMatch: { userId } } },
      { $set: { "participants.$.state": "failed", "participants.$.lastError": error, lastActivityAt: now } }
    );
    return updatedDocument(result);
  }

  async function lockChannel(
    incidentId: string,
    channelId: string,
    previousSendMessages: boolean | null,
    now = new Date()
  ): Promise<boolean> {
    const locked: LockedChannel = { channelId, previousSendMessages, lockedAt: now, restoredAt: null };
    const result = await model.updateOne(
      { _id: incidentId, "lockedChannels.channelId": { $ne: channelId } },
      { $push: { lockedChannels: locked }, $set: { lastActivityAt: now } }
    );
    return updatedDocument(result);
  }

  async function markChannelRestored(incidentId: string, channelId: string, now = new Date()): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId, lockedChannels: { $elemMatch: { channelId, restoredAt: null } } },
      { $set: { "lockedChannels.$.restoredAt": now } }
    );
    return updatedDocument(result);
  }

  async function recordError(incidentId: string, message: string, now = new Date()): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId },
      { $push: { errors: { $each: [message], $slice: -50 } }, $set: { lastActivityAt: now } }
    );
    return updatedDocument(result);
  }

  async function setPendingActions(incidentId: string, actions: readonly string[]): Promise<boolean> {
    return updatedDocument(await model.updateOne({ _id: incidentId }, { $set: { pendingActions: [...actions] } }));
  }

  async function setRestoreProgress(incidentId: string, progress: number): Promise<boolean> {
    const clamped = Math.min(100, Math.max(0, Math.round(progress)));
    return updatedDocument(await model.updateOne({ _id: incidentId }, { $set: { restoreProgress: clamped } }));
  }

  return {
    active,
    read,
    latest,
    history,
    open,
    advance,
    touch,
    addParticipant,
    removeParticipant,
    recordSanction,
    markParticipantFailed,
    lockChannel,
    markChannelRestored,
    recordError,
    setPendingActions,
    setRestoreProgress
  };
}

export type RaidIncidentRepository = ReturnType<typeof createRaidIncidentRepository>;
