"use strict";

import { createdDocument, updatedDocument } from "../../shared/persistenceOutcome.js";
import { AD_STRIKE_LIMIT, scopeMatchesAdApproval, strikeOutcome } from "./adRequestTypes.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type { AdAttemptRecord, AdRequestRecord, AdRequestStatus, StrikeOutcome } from "./adRequestTypes.js";

export const AD_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const AD_APPROVED_TTL_MS = 60 * 60 * 1000;
const HISTORY_LIMIT = 50;

export interface AdRequestModelLike {
  findOne(filter: Record<string, unknown>, projection?: Record<string, unknown>): {
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
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

export type AdAttemptModelLike = AdRequestModelLike;

function asRequest(document: Record<string, unknown> | null): AdRequestRecord | null {
  return document ? (document as Record<string, unknown> & AdRequestRecord) : null;
}

function asAttempt(document: Record<string, unknown> | null): AdAttemptRecord | null {
  if (!document) return null;
  const record = document as Record<string, unknown> & AdAttemptRecord;
  return { ...record, history: record.history ?? [] };
}

export interface CreateAdRequestInput {
  requestId: string;
  guildId: string;
  requesterId: string;
  adText: string;
  fingerprint: string;
  link: string | null;
  invite: string | null;
  attachmentUrl: string | null;
  target: string | null;
  ttlMs?: number;
}

export function createAdProtectionRepository(requests: AdRequestModelLike, attempts: AdAttemptModelLike) {
  async function expireStale(guildId: string, now: Date): Promise<void> {
    await requests.updateMany(
      { guildId, status: { $in: ["pending", "approved"] }, expiresAt: { $lte: now } },
      { $set: { status: "expired" } }
    );
  }

  async function createRequest(input: CreateAdRequestInput, now = new Date()): Promise<AdRequestRecord | null> {
    await expireStale(input.guildId, now);
    const record: AdRequestRecord = {
      _id: input.requestId,
      guildId: input.guildId,
      requesterId: input.requesterId,
      adText: input.adText,
      fingerprint: input.fingerprint,
      link: input.link,
      invite: input.invite,
      attachmentUrl: input.attachmentUrl,
      target: input.target,
      status: "pending",
      ownerId: null,
      requestedAt: now,
      respondedAt: null,
      usedAt: null,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? AD_PENDING_TTL_MS))
    };
    const result = await requests.updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    return createdDocument(result) ? record : null;
  }

  async function readRequest(guildId: string, requestId: string): Promise<AdRequestRecord | null> {
    return asRequest(await requests.findOne({ _id: requestId, guildId }).lean());
  }

  async function listRequests(guildId: string, limit = 50, now = new Date()): Promise<AdRequestRecord[]> {
    await expireStale(guildId, now);
    const documents = await requests.find({ guildId }).sort({ requestedAt: -1 }).limit(limit).lean();
    return documents.map(document => asRequest(document)).filter((record): record is AdRequestRecord => record !== null);
  }

  async function resolveRequest(
    guildId: string,
    requestId: string,
    decision: Extract<AdRequestStatus, "approved" | "rejected">,
    ownerId: string,
    now = new Date()
  ): Promise<AdRequestRecord | null> {
    await expireStale(guildId, now);
    const result = await requests.updateOne(
      { _id: requestId, guildId, status: "pending", expiresAt: { $gt: now } },
      {
        $set: {
          status: decision,
          ownerId,
          respondedAt: now,
          expiresAt: decision === "approved" ? new Date(now.getTime() + AD_APPROVED_TTL_MS) : null
        }
      }
    );
    if (!updatedDocument(result)) return null;
    return readRequest(guildId, requestId);
  }

  async function consumeApproval(
    guildId: string,
    requesterId: string,
    fingerprint: string,
    now = new Date()
  ): Promise<AdRequestRecord | null> {
    await expireStale(guildId, now);
    const candidates = await requests
      .find({ guildId, requesterId, status: "approved", expiresAt: { $gt: now } })
      .sort({ respondedAt: 1 })
      .limit(20)
      .lean();

    for (const document of candidates) {
      const candidate = asRequest(document);
      if (!candidate || !scopeMatchesAdApproval(candidate, fingerprint, requesterId)) continue;
      const claimed = await requests.updateOne(
        { _id: candidate._id, guildId, status: "approved", expiresAt: { $gt: now } },
        { $set: { status: "used", usedAt: now } }
      );
      if (updatedDocument(claimed)) return { ...candidate, status: "used", usedAt: now };
    }
    return null;
  }

  async function cancelRequest(guildId: string, requestId: string): Promise<boolean> {
    const result = await requests.updateOne(
      { _id: requestId, guildId, status: "pending" },
      { $set: { status: "cancelled" } }
    );
    return updatedDocument(result);
  }

  async function cancelActiveRequests(guildId: string): Promise<void> {
    await requests.updateMany(
      { guildId, status: { $in: ["pending", "approved"] } },
      { $set: { status: "cancelled" } }
    );
  }

  async function readAttempts(guildId: string, userId: string): Promise<AdAttemptRecord | null> {
    return asAttempt(await attempts.findOne({ _id: `${guildId}:${userId}` }).lean());
  }

  async function listAttempts(guildId: string, limit = 200): Promise<AdAttemptRecord[]> {
    const documents = await attempts.find({ guildId }).sort({ lastAttemptAt: -1 }).limit(limit).lean();
    return documents.map(document => asAttempt(document)).filter((record): record is AdAttemptRecord => record !== null);
  }

  async function recordAttempt(
    guildId: string,
    userId: string,
    channelId: string | null,
    summary: string,
    now = new Date()
  ): Promise<StrikeOutcome> {
    const id = `${guildId}:${userId}`;
    await attempts.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id, guildId, userId, strikes: 0, totalDeleted: 0, totalWarns: 0,
          lastAttemptAt: null, lastChannelId: null, history: []
        }
      },
      { upsert: true }
    );

    const bumped = await attempts.updateOne(
      { _id: id, strikes: { $lt: AD_STRIKE_LIMIT - 1 } },
      {
        $inc: { strikes: 1, totalDeleted: 1 },
        $set: { lastAttemptAt: now, lastChannelId: channelId },
        $push: { history: { $each: [{ at: now, channelId, summary, warned: false }], $slice: -HISTORY_LIMIT } }
      }
    );
    if (updatedDocument(bumped)) {
      const stored = await readAttempts(guildId, userId);
      return strikeOutcome(stored?.strikes ?? 1);
    }

    await attempts.updateOne(
      { _id: id },
      {
        $inc: { totalDeleted: 1, totalWarns: 1 },
        $set: { strikes: 0, lastAttemptAt: now, lastChannelId: channelId },
        $push: { history: { $each: [{ at: now, channelId, summary, warned: true }], $slice: -HISTORY_LIMIT } }
      }
    );
    return strikeOutcome(AD_STRIKE_LIMIT);
  }

  return {
    createRequest,
    readRequest,
    listRequests,
    resolveRequest,
    cancelRequest,
    consumeApproval,
    cancelActiveRequests,
    readAttempts,
    listAttempts,
    recordAttempt,
    expireStale
  };
}

export type AdProtectionRepository = ReturnType<typeof createAdProtectionRepository>;
