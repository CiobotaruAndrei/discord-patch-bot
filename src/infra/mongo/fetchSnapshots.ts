"use strict";

interface FetchSnapshotDoc {
  _id: string;
  payload?: unknown;
  fetchedAt?: Date | string | number;
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

interface FetchSnapshotModelLike {
  updateOne(
    filter: { _id: string },
    update: { $set: { payload: unknown; fetchedAt: Date } },
    options?: { upsert?: boolean }
  ): Promise<unknown>;
  findById(id: string): { lean(): Promise<unknown> };
  find(filter: { _id: { $regex: string } }): { lean(): Promise<unknown> };
}

interface FetchSnapshotsContext {
  FetchSnapshotModel: FetchSnapshotModelLike;
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

function asFetchSnapshotDoc(value: unknown): FetchSnapshotDoc | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as { _id?: unknown; payload?: unknown; fetchedAt?: unknown };
  if (typeof doc._id !== "string") return null;
  return { _id: doc._id, payload: doc.payload, fetchedAt: doc.fetchedAt as FetchSnapshotDoc["fetchedAt"] };
}

function toValidDate(value: Date | string | number | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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
    const doc = asFetchSnapshotDoc(await runtimeContext.FetchSnapshotModel.findById(id).lean());
    const fetchedAt = toValidDate(doc?.fetchedAt);
    if (!doc || doc.payload == null || !fetchedAt) return null;
    return { payload: doc.payload, fetchedAt };
  } catch (err) {
    runtimeContext.logger("WARN", "FETCH_SNAPSHOT", `Nu am putut citi snapshot-ul ${id}`, errorText(err));
    return null;
  }
}

async function loadDealsFetchSnapshots(): Promise<LoadedDealsFetchSnapshot[]> {
  try {
    const rawDocs = await runtimeContext.FetchSnapshotModel
      .find({ _id: { $regex: `^${DEALS_SNAPSHOT_PREFIX}` } })
      .lean();
    const docs = Array.isArray(rawDocs) ? rawDocs.map(asFetchSnapshotDoc) : [];
    const out: LoadedDealsFetchSnapshot[] = [];
    for (const doc of docs) {
      const fetchedAt = toValidDate(doc?.fetchedAt);
      if (!doc || doc.payload == null || !fetchedAt) continue;
      out.push({
        currency: doc._id.slice(DEALS_SNAPSHOT_PREFIX.length),
        payload: doc.payload,
        fetchedAt
      });
    }
    return out;
  } catch (err) {
    runtimeContext.logger("WARN", "FETCH_SNAPSHOT", "Nu am putut citi snapshot-urile de reduceri", errorText(err));
    return [];
  }
}

function buildFetchSnapshotsFrom(context: FetchSnapshotsContext) {
  runtimeContext = {
    FetchSnapshotModel: context.FetchSnapshotModel,
    withMongoRetry: context.withMongoRetry,
    logger: context.logger
  };

  return {
    saveFetchSnapshot,
    loadFetchSnapshot,
    loadDealsFetchSnapshots
  };
}

function attachFetchSnapshots(target: FetchSnapshotsContext): void {
  Object.assign(target, buildFetchSnapshotsFrom(target));
}

attachFetchSnapshots.buildFrom = buildFetchSnapshotsFrom;

export default attachFetchSnapshots;
