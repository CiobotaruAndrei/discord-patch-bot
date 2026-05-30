"use strict";

import type { Model } from "mongoose";

interface FetchSnapshotDoc {
  _id: string;
  payload?: unknown;
  fetchedAt?: Date;
}

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { retries?: number; label?: string }) => Promise<T>;

interface LoadedFetchSnapshot {
  payload: unknown;
  fetchedAt: Date;
}

interface LoadedDealsFetchSnapshot extends LoadedFetchSnapshot {
  currency: string;
}

interface FetchSnapshotsContext {
  FetchSnapshotModel: Model<FetchSnapshotDoc>;
  withMongoRetry: WithMongoRetry;
  logger: Logger;
  saveFetchSnapshot?: typeof saveFetchSnapshot;
  loadFetchSnapshot?: typeof loadFetchSnapshot;
  loadDealsFetchSnapshots?: typeof loadDealsFetchSnapshots;
}

const DEALS_SNAPSHOT_PREFIX = "deals:";

let runtimeContext: Pick<FetchSnapshotsContext, "FetchSnapshotModel" | "withMongoRetry" | "logger">;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function saveFetchSnapshot(id: string, payload: unknown): Promise<void> {
  try {
    await runtimeContext.withMongoRetry(
      () => runtimeContext.FetchSnapshotModel.updateOne(
        { _id: id },
        { $set: { payload, fetchedAt: new Date() } },
        { upsert: true }
      ),
      { label: `saveFetchSnapshot:${id}` }
    );
  } catch (err) {
    runtimeContext.logger("WARN", "FETCH_SNAPSHOT", `Nu am putut salva snapshot-ul ${id}`, errorText(err));
  }
}

async function loadFetchSnapshot(id: string): Promise<LoadedFetchSnapshot | null> {
  try {
    const doc = await runtimeContext.FetchSnapshotModel.findById(id).lean() as FetchSnapshotDoc | null;
    if (!doc || doc.payload == null || !doc.fetchedAt) return null;
    return { payload: doc.payload, fetchedAt: new Date(doc.fetchedAt) };
  } catch (err) {
    runtimeContext.logger("WARN", "FETCH_SNAPSHOT", `Nu am putut citi snapshot-ul ${id}`, errorText(err));
    return null;
  }
}

async function loadDealsFetchSnapshots(): Promise<LoadedDealsFetchSnapshot[]> {
  try {
    const docs = await runtimeContext.FetchSnapshotModel
      .find({ _id: { $regex: `^${DEALS_SNAPSHOT_PREFIX}` } })
      .lean() as FetchSnapshotDoc[];
    const out: LoadedDealsFetchSnapshot[] = [];
    for (const doc of docs) {
      if (!doc || doc.payload == null || !doc.fetchedAt) continue;
      out.push({
        currency: doc._id.slice(DEALS_SNAPSHOT_PREFIX.length),
        payload: doc.payload,
        fetchedAt: new Date(doc.fetchedAt)
      });
    }
    return out;
  } catch (err) {
    runtimeContext.logger("WARN", "FETCH_SNAPSHOT", "Nu am putut citi snapshot-urile de reduceri", errorText(err));
    return [];
  }
}

function attachFetchSnapshots(target: FetchSnapshotsContext): void {
  runtimeContext = {
    FetchSnapshotModel: target.FetchSnapshotModel,
    withMongoRetry: target.withMongoRetry,
    logger: target.logger
  };

  Object.assign(target, {
    saveFetchSnapshot,
    loadFetchSnapshot,
    loadDealsFetchSnapshots
  });
}

export = attachFetchSnapshots;
