import { changedDocument } from "./persistenceOutcome.js";
import { errorText, fallbackVersion } from "./operationJournalContracts.js";

import type {
  JournaledOperationOptions,
  OperationJournalDoc,
  OperationJournalModelLike
} from "./operationJournalContracts.js";

interface OperationJournalStoreDeps {
  JournalModel: OperationJournalModelLike;
  now: () => Date;
  ownerId: string;
  leaseMs: number;
  maxAttempts: number;
  schemaVersionFor: (kind: string) => number;
}

function createOperationJournalStore(deps: OperationJournalStoreDeps) {
  const { JournalModel, now, ownerId, leaseMs, maxAttempts } = deps;

  function leaseGuard(entry: OperationJournalDoc): Record<string, unknown> {
    return {
      _id: entry._id,
      status: "leased",
      lockedBy: ownerId,
      leaseVersion: entry.leaseVersion
    };
  }

  async function ensurePending(key: string, kind: string, payload: unknown, at: Date, options?: JournaledOperationOptions): Promise<void> {
    await JournalModel.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          kind,
          payload,
          schemaVersion: options?.schemaVersion ?? deps.schemaVersionFor(kind),
          resourceKey: options?.resourceKey ?? key,
          resourceVersion: options?.resourceVersion ?? fallbackVersion(at, key),
          status: "pending",
          attempts: 0,
          leaseVersion: 0,
          createdAt: at,
          updatedAt: at
        }
      },
      { upsert: true }
    );
  }

  async function claim(key: string, at: Date): Promise<OperationJournalDoc | null> {
    const lockedUntil = new Date(at.getTime() + leaseMs);
    return JournalModel.findOneAndUpdate(
      {
        _id: key,
        attempts: { $lt: maxAttempts },
        $or: [
          { status: "pending" },
          { status: "leased", lockedUntil: { $lte: at } }
        ]
      },
      {
        $set: { status: "leased", lockedBy: ownerId, lockedUntil, updatedAt: at },
        $inc: { attempts: 1, leaseVersion: 1 }
      },
      { returnDocument: "after" }
    ).lean();
  }

  async function markTerminal(entry: OperationJournalDoc, status: "done" | "superseded" | "failed", lastError: string | null = null): Promise<void> {
    const result = await JournalModel.updateOne(
      leaseGuard(entry),
      {
        $set: { status, lastError, lockedBy: null, lockedUntil: null, updatedAt: now() }
      }
    );
    if (!changedDocument(result)) {
      throw new Error(`operationJournal: lease pierdut inainte de finalizarea operatiei '${entry._id}'`);
    }
  }

  async function releaseAfterFailure(entry: OperationJournalDoc, err: unknown): Promise<void> {
    const status = entry.attempts >= maxAttempts ? "failed" : "pending";
    await JournalModel.updateOne(
      leaseGuard(entry),
      {
        $set: { status, lastError: errorText(err), lockedBy: null, lockedUntil: null, updatedAt: now() }
      }
    );
  }

  async function supersededByNewerOperation(entry: OperationJournalDoc): Promise<boolean> {
    const newer = await JournalModel.findOne({
      resourceKey: entry.resourceKey,
      resourceVersion: { $gt: entry.resourceVersion }
    }).lean();
    return Boolean(newer);
  }

  async function renewLease(entry: OperationJournalDoc, at: Date): Promise<boolean> {
    const result = await JournalModel.updateOne(
      leaseGuard(entry),
      { $set: { lockedUntil: new Date(at.getTime() + leaseMs), updatedAt: at } }
    );
    return changedDocument(result);
  }

  async function readEntry(key: string): Promise<OperationJournalDoc | null> {
    return JournalModel.findOne({ _id: key }).lean();
  }

  async function failUnclaimed(candidate: OperationJournalDoc, reason: string, at: Date): Promise<void> {
    await JournalModel.updateOne(
      { _id: candidate._id, status: candidate.status, leaseVersion: candidate.leaseVersion },
      { $set: { status: "failed", lastError: reason, lockedBy: null, lockedUntil: null, updatedAt: at } }
    );
  }

  async function listStale(at: Date, olderThanMs: number, limit: number): Promise<OperationJournalDoc[]> {
    const cutoff = new Date(at.getTime() - olderThanMs);
    const rows = await JournalModel.find({
      $or: [
        { status: "pending", updatedAt: { $lte: cutoff } },
        { status: "leased", lockedUntil: { $lte: at } }
      ]
    }).sort({ updatedAt: 1 }).limit(limit).lean();
    return Array.isArray(rows) ? rows : [];
  }

  return {
    ensurePending,
    claim,
    markTerminal,
    releaseAfterFailure,
    supersededByNewerOperation,
    renewLease,
    readEntry,
    failUnclaimed,
    listStale
  };
}

type OperationJournalStore = ReturnType<typeof createOperationJournalStore>;

export { createOperationJournalStore };
export type { OperationJournalStore, OperationJournalStoreDeps };
