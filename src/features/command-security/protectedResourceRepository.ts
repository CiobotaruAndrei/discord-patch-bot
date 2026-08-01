"use strict";

import { createdDocument, updatedDocument } from "../../shared/persistenceOutcome.js";
import { emptySnapshot } from "./protectedResourceTypes.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type {
  ProtectedResourceRecord,
  ProtectedResourceSnapshot,
  ProtectedResourceType
} from "./protectedResourceTypes.js";

export const PROTECTED_RESOURCE_LIMIT = 100;

export interface ProtectedResourceModelLike {
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
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number } | null | undefined>;
}

function asRecord(document: Record<string, unknown> | null): ProtectedResourceRecord | null {
  if (!document) return null;
  const record = document as Record<string, unknown> & ProtectedResourceRecord;
  return { ...record, snapshot: { ...emptySnapshot(), ...record.snapshot } };
}

export interface AddProtectedResourceInput {
  guildId: string;
  resourceId: string;
  type: ProtectedResourceType;
  addedBy: string;
  snapshot: ProtectedResourceSnapshot;
  degraded: boolean;
  degradedReasons: readonly string[];
  preventionApplied: boolean;
}

export type AddProtectedResourceOutcome =
  | { kind: "added"; record: ProtectedResourceRecord }
  | { kind: "already-protected" }
  | { kind: "limit-reached"; limit: number };

export function createProtectedResourceRepository(model: ProtectedResourceModelLike) {
  function documentId(guildId: string, resourceId: string): string {
    return `${guildId}:${resourceId}`;
  }

  async function list(guildId: string, limit = PROTECTED_RESOURCE_LIMIT): Promise<ProtectedResourceRecord[]> {
    const documents = await model.find({ guildId }).sort({ addedAt: 1 }).limit(limit).lean();
    return documents
      .map(document => asRecord(document))
      .filter((record): record is ProtectedResourceRecord => record !== null);
  }

  async function read(guildId: string, resourceId: string): Promise<ProtectedResourceRecord | null> {
    return asRecord(await model.findOne({ _id: documentId(guildId, resourceId) }).lean());
  }

  async function add(input: AddProtectedResourceInput, now = new Date()): Promise<AddProtectedResourceOutcome> {
    const existing = await read(input.guildId, input.resourceId);
    if (existing) return { kind: "already-protected" };

    const current = await list(input.guildId, PROTECTED_RESOURCE_LIMIT);
    if (current.length >= PROTECTED_RESOURCE_LIMIT) return { kind: "limit-reached", limit: PROTECTED_RESOURCE_LIMIT };

    const record: ProtectedResourceRecord = {
      _id: documentId(input.guildId, input.resourceId),
      guildId: input.guildId,
      resourceId: input.resourceId,
      type: input.type,
      addedBy: input.addedBy,
      addedAt: now,
      snapshot: input.snapshot,
      snapshotAt: now,
      degraded: input.degraded,
      degradedReasons: [...input.degradedReasons],
      preventionApplied: input.preventionApplied,
      lastRestoredAt: null,
      recreatedFromId: null
    };
    const result = await model.updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    return createdDocument(result) ? { kind: "added", record } : { kind: "already-protected" };
  }

  async function remove(guildId: string, resourceId: string): Promise<boolean> {
    const result = await model.deleteOne({ _id: documentId(guildId, resourceId) });
    return (result?.deletedCount ?? 0) > 0;
  }

  async function refreshSnapshot(
    guildId: string,
    resourceId: string,
    snapshot: ProtectedResourceSnapshot,
    now = new Date()
  ): Promise<boolean> {
    const result = await model.updateOne(
      { _id: documentId(guildId, resourceId) },
      { $set: { snapshot, snapshotAt: now } }
    );
    return updatedDocument(result);
  }

  async function markReadiness(
    guildId: string,
    resourceId: string,
    degraded: boolean,
    reasons: readonly string[],
    preventionApplied: boolean
  ): Promise<boolean> {
    const result = await model.updateOne(
      { _id: documentId(guildId, resourceId) },
      { $set: { degraded, degradedReasons: [...reasons], preventionApplied } }
    );
    return updatedDocument(result);
  }

  async function markRestored(
    guildId: string,
    resourceId: string,
    now = new Date(),
    recreatedFromId: string | null = null
  ): Promise<boolean> {
    const set: Record<string, unknown> = { lastRestoredAt: now };
    if (recreatedFromId !== null) set.recreatedFromId = recreatedFromId;
    const result = await model.updateOne({ _id: documentId(guildId, resourceId) }, { $set: set });
    return updatedDocument(result);
  }

  async function rebind(
    guildId: string,
    previousResourceId: string,
    nextResourceId: string,
    now = new Date()
  ): Promise<ProtectedResourceRecord | null> {
    const previous = await read(guildId, previousResourceId);
    if (!previous) return null;
    const record: ProtectedResourceRecord = {
      ...previous,
      _id: documentId(guildId, nextResourceId),
      resourceId: nextResourceId,
      lastRestoredAt: now,
      recreatedFromId: previousResourceId
    };
    const created = await model.updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    if (!createdDocument(created)) return null;
    await remove(guildId, previousResourceId);
    return record;
  }

  return { list, read, add, remove, refreshSnapshot, markReadiness, markRestored, rebind };
}

export type ProtectedResourceRepository = ReturnType<typeof createProtectedResourceRepository>;
