"use strict";

import { createdDocument, updatedDocument } from "../../shared/persistenceOutcome.js";
import { emptyProtections, RAID_SNAPSHOT_VERSION } from "./raidSnapshotTypes.js";
import { baselineId } from "./raidBaselineSnapshot.js";

import type { WriteCounts } from "../../shared/persistenceOutcome.js";
import type { RaidSnapshot, RecoveryOperation, RecoveryStatus, SnapshotProtections } from "./raidSnapshotTypes.js";
import type { BaselineRecord } from "./raidBaselineSnapshot.js";
import type { ResourceRemap } from "./raidSnapshotTypes.js";

export interface RaidSnapshotModelLike {
  findOne(filter: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<WriteCounts | null | undefined>;
}

export interface RaidSnapshotRecord {
  _id: string;
  incidentId: string;
  guildId: string;
  snapshot: RaidSnapshot;
  operations: RecoveryOperation[];
  remaps: ResourceRemap[];
}

function asRemaps(value: unknown): ResourceRemap[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map(entry => ({ previousId: String(entry.previousId ?? ""), nextId: String(entry.nextId ?? "") }))
    .filter(entry => entry.previousId.length > 0 && entry.nextId.length > 0);
}

function asOperations(value: unknown): RecoveryOperation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map(entry => ({
      kind: String(entry.kind) as RecoveryOperation["kind"],
      resourceId: String(entry.resourceId ?? ""),
      label: String(entry.label ?? ""),
      status: String(entry.status ?? "pending") as RecoveryStatus,
      attempts: typeof entry.attempts === "number" ? entry.attempts : 0,
      detail: typeof entry.detail === "string" ? entry.detail : null
    }))
    .filter(operation => operation.resourceId.length > 0);
}

function asSnapshot(value: unknown, capturedAt: Date): RaidSnapshot {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const list = <T>(field: unknown): T[] => (Array.isArray(field) ? (field as T[]) : []);
  return {
    version: typeof raw.version === "number" ? raw.version : RAID_SNAPSHOT_VERSION,
    capturedAt: raw.capturedAt instanceof Date ? raw.capturedAt : capturedAt,
    channels: list(raw.channels),
    roles: list(raw.roles),
    webhooks: list(raw.webhooks),
    invites: list(raw.invites),
    protections: { ...emptyProtections(), ...(raw.protections as SnapshotProtections | undefined) }
  };
}

export function createRaidSnapshotRepository(model: RaidSnapshotModelLike) {
  async function read(incidentId: string): Promise<RaidSnapshotRecord | null> {
    const document = await model.findOne({ _id: incidentId }).lean();
    if (!document) return null;
    return {
      _id: String(document._id),
      incidentId,
      guildId: String(document.guildId ?? ""),
      snapshot: asSnapshot(document.snapshot, new Date(0)),
      operations: asOperations(document.operations),
      remaps: asRemaps(document.remaps)
    };
  }

  async function capture(incidentId: string, guildId: string, snapshot: RaidSnapshot): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId },
      { $setOnInsert: { _id: incidentId, guildId, snapshot, operations: [], capturedAt: snapshot.capturedAt } },
      { upsert: true }
    );
    return createdDocument(result);
  }

  async function savePlan(incidentId: string, operations: readonly RecoveryOperation[]): Promise<boolean> {
    const result = await model.updateOne({ _id: incidentId }, { $set: { operations: [...operations] } });
    return updatedDocument(result);
  }

  async function markOperation(
    incidentId: string,
    kind: RecoveryOperation["kind"],
    resourceId: string,
    status: RecoveryStatus,
    detail: string | null
  ): Promise<boolean> {
    const record = await read(incidentId);
    if (!record) return false;
    const operations = record.operations.map(operation =>
      operation.kind === kind && operation.resourceId === resourceId
        ? { ...operation, status, detail, attempts: operation.attempts + 1 }
        : operation
    );
    return savePlan(incidentId, operations);
  }

  async function readBaseline(guildId: string): Promise<BaselineRecord | null> {
    const document = await model.findOne({ _id: baselineId(guildId) }).lean();
    if (!document) return null;
    return {
      guildId,
      snapshot: asSnapshot(document.snapshot, new Date(0)),
      frozenAt: document.frozenAt instanceof Date ? document.frozenAt : null
    };
  }

  async function writeBaseline(guildId: string, snapshot: RaidSnapshot): Promise<boolean> {
    const result = await model.updateOne(
      { _id: baselineId(guildId), frozenAt: null },
      { $set: { guildId, snapshot, capturedAt: snapshot.capturedAt, frozenAt: null } },
      { upsert: true }
    );
    return createdDocument(result) || updatedDocument(result);
  }

  async function freezeBaseline(guildId: string, at: Date): Promise<boolean> {
    const result = await model.updateOne(
      { _id: baselineId(guildId), frozenAt: null },
      { $set: { frozenAt: at } }
    );
    return updatedDocument(result);
  }

  async function thawBaseline(guildId: string): Promise<boolean> {
    const result = await model.updateOne(
      { _id: baselineId(guildId) },
      { $set: { frozenAt: null } }
    );
    return updatedDocument(result);
  }

  async function appendOperation(incidentId: string, entry: RecoveryOperation): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId, operations: { $not: { $elemMatch: { kind: entry.kind, resourceId: entry.resourceId } } } },
      { $push: { operations: entry } }
    );
    return updatedDocument(result);
  }

  async function rememberRemap(incidentId: string, remap: ResourceRemap): Promise<boolean> {
    const result = await model.updateOne(
      { _id: incidentId },
      { $push: { remaps: remap } }
    );
    return updatedDocument(result);
  }

  return {
    read, capture, savePlan, markOperation, appendOperation, rememberRemap,
    readBaseline, writeBaseline, freezeBaseline, thawBaseline
  };
}

export type RaidSnapshotRepository = ReturnType<typeof createRaidSnapshotRepository>;
