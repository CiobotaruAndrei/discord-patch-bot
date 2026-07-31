"use strict";

import type {
  PlayerCountHistoryModelLike,
  PlayerCountHistoryPoint,
  PlayerCountRecord,
  PlayerCountRecordModelLike,
  PlayerCountSnapshot,
  PlayerCountSnapshotModelLike
} from "./playerCountTypes.js";
import { validCount, validDate } from "./playerCountTypes.js";

export interface PlayerCountQueryDeps {
  PlayerCountSnapshotModel: PlayerCountSnapshotModelLike;
  PlayerCountHistoryModel: PlayerCountHistoryModelLike;
  PlayerCountRecordModel: PlayerCountRecordModelLike;
}

export function createPlayerCountQueryService(deps: PlayerCountQueryDeps) {
  const { PlayerCountSnapshotModel, PlayerCountHistoryModel, PlayerCountRecordModel } = deps;

  async function readPlayerCountSnapshots(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountSnapshot>> {
    const ids = appIds.map(String).filter(Boolean);
    const snapshots = new Map<string, PlayerCountSnapshot>();
    if (!ids.length) return snapshots;
    const docs = await PlayerCountSnapshotModel.find({ _id: { $in: ids } }).lean();
    for (const doc of docs) {
      const fetchedAt = validDate(doc.fetchedAt);
      const playerCount = validCount(doc.playerCount);
      if (!fetchedAt || playerCount === null) continue;
      snapshots.set(String(doc._id), { appId: String(doc._id), gameKey: String(doc.gameKey || ""), playerCount, fetchedAt });
    }
    return snapshots;
  }

  async function readPlayerCountHistory(appIds: readonly (string | number)[], since: Date): Promise<PlayerCountHistoryPoint[]> {
    const ids = appIds.map(String).filter(Boolean);
    if (!ids.length || !Number.isFinite(since.getTime())) return [];
    const docs = await PlayerCountHistoryModel.find({ appId: { $in: ids }, fetchedAt: { $gte: since } }).sort({ fetchedAt: 1 }).lean();
    const points: PlayerCountHistoryPoint[] = [];
    for (const doc of docs) {
      const fetchedAt = validDate(doc.fetchedAt);
      const playerCount = validCount(doc.playerCount);
      const appId = String(doc.appId || "");
      if (!appId || !fetchedAt || playerCount === null) continue;
      points.push({ appId, gameKey: String(doc.gameKey || ""), playerCount, fetchedAt });
    }
    return points;
  }

  async function readPlayerCountRecords(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountRecord>> {
    const ids = appIds.map(String).filter(Boolean);
    const records = new Map<string, PlayerCountRecord>();
    if (!ids.length) return records;
    const docs = await PlayerCountRecordModel.find({ _id: { $in: ids } }).lean();
    for (const doc of docs) {
      const reachedAt = validDate(doc.reachedAt);
      const playerCount = validCount(doc.playerCount);
      if (!reachedAt || playerCount === null) continue;
      records.set(String(doc._id), { appId: String(doc._id), gameKey: String(doc.gameKey || ""), playerCount, reachedAt });
    }
    return records;
  }

  return { readPlayerCountSnapshots, readPlayerCountHistory, readPlayerCountRecords };
}
