"use strict";

import { createdDocument, updatedDocument } from "../../shared/persistenceOutcome.js";
import { scopeMatchesApproval, stripInapplicableFields } from "./permissionRequestTypes.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type {
  PermissionRequestRecord,
  PermissionRequestScope,
  PermissionRequestStatus,
  PermissionRequestType
} from "./permissionRequestTypes.js";

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const APPROVED_TTL_MS = 60 * 60 * 1000;

export interface PermissionRequestModelLike {
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

function asRecord(document: Record<string, unknown> | null): PermissionRequestRecord | null {
  return document ? (document as Record<string, unknown> & PermissionRequestRecord) : null;
}

function asRecords(documents: Array<Record<string, unknown>>): PermissionRequestRecord[] {
  return documents.map(document => document as Record<string, unknown> & PermissionRequestRecord);
}

export interface CreatePermissionRequestInput extends PermissionRequestScope {
  requestId: string;
  guildId: string;
  type: PermissionRequestType;
  requesterId: string;
  reason: string;
  ttlMs?: number;
}

export interface ApprovalRestriction {
  target?: string;
  action?: string;
  amount?: number | null;
  permissions?: string[];
  ttlMs?: number;
}

export function createPermissionRequestRepository(model: PermissionRequestModelLike) {
  async function expireStale(guildId: string, now: Date): Promise<void> {
    await model.updateMany(
      { guildId, status: { $in: ["pending", "approved"] }, expiresAt: { $lte: now } },
      { $set: { status: "expired" } }
    );
  }

  async function create(input: CreatePermissionRequestInput, now = new Date()): Promise<PermissionRequestRecord | null> {
    await expireStale(input.guildId, now);
    const scope = stripInapplicableFields(input.type, input);
    const record: PermissionRequestRecord = {
      _id: input.requestId,
      guildId: input.guildId,
      type: input.type,
      requesterId: input.requesterId,
      reason: input.reason,
      status: "pending",
      requestedAt: now,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? PENDING_TTL_MS)),
      ...scope
    };
    const result = await model.updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    return createdDocument(result) ? record : null;
  }

  async function read(guildId: string, requestId: string): Promise<PermissionRequestRecord | null> {
    return asRecord(await model.findOne({ _id: requestId, guildId }).lean());
  }

  async function list(
    guildId: string,
    filters: { status?: PermissionRequestStatus; type?: PermissionRequestType },
    limit: number,
    now = new Date()
  ): Promise<PermissionRequestRecord[]> {
    await expireStale(guildId, now);
    const filter: Record<string, unknown> = { guildId };
    if (filters.status) filter.status = filters.status;
    if (filters.type) filter.type = filters.type;
    return asRecords(await model.find(filter).sort({ requestedAt: -1 }).limit(limit).lean());
  }

  async function resolve(
    guildId: string,
    requestId: string,
    decision: "approved" | "rejected",
    ownerId: string,
    restriction: ApprovalRestriction = {},
    now = new Date()
  ): Promise<PermissionRequestRecord | null> {
    await expireStale(guildId, now);
    const set: Record<string, unknown> = {
      status: decision,
      ownerId,
      respondedAt: now,
      expiresAt: decision === "approved" ? new Date(now.getTime() + (restriction.ttlMs ?? APPROVED_TTL_MS)) : null
    };
    if (decision === "approved") {
      if (restriction.target !== undefined) set.approvedTarget = restriction.target;
      if (restriction.action !== undefined) set.approvedAction = restriction.action;
      if (restriction.amount !== undefined) set.approvedAmount = restriction.amount;
      if (restriction.permissions !== undefined) set.approvedPermissions = [...restriction.permissions];
    }
    const result = await model.updateOne(
      { _id: requestId, guildId, status: "pending", expiresAt: { $gt: now } },
      { $set: set }
    );
    if (!updatedDocument(result)) return null;
    return read(guildId, requestId);
  }

  async function consume(
    guildId: string,
    type: PermissionRequestType,
    requesterId: string,
    attempt: PermissionRequestScope,
    now = new Date()
  ): Promise<PermissionRequestRecord | null> {
    await expireStale(guildId, now);
    const candidates = asRecords(await model
      .find({ guildId, type, requesterId, status: "approved", expiresAt: { $gt: now } })
      .sort({ respondedAt: 1 })
      .limit(20)
      .lean());
    for (const candidate of candidates) {
      if (!scopeMatchesApproval(candidate, attempt)) continue;
      const claimed = await model.updateOne(
        { _id: candidate._id, guildId, status: "approved", expiresAt: { $gt: now } },
        { $set: { status: "used", usedAt: now } }
      );
      if (updatedDocument(claimed)) return { ...candidate, status: "used", usedAt: now };
    }
    return null;
  }

  async function cancelTypes(guildId: string, types: readonly PermissionRequestType[]): Promise<void> {
    await model.updateMany(
      { guildId, type: { $in: [...types] }, status: { $in: ["pending", "approved"] } },
      { $set: { status: "cancelled" } }
    );
  }

  async function countActive(guildId: string, now = new Date()): Promise<number> {
    await expireStale(guildId, now);
    const active = asRecords(await model
      .find({ guildId, status: { $in: ["pending", "approved"] }, expiresAt: { $gt: now } })
      .sort({ requestedAt: -1 })
      .limit(1000)
      .lean());
    return active.length;
  }

  return { create, read, list, resolve, consume, cancelTypes, countActive, expireStale };
}

export type PermissionRequestRepository = ReturnType<typeof createPermissionRequestRepository>;
