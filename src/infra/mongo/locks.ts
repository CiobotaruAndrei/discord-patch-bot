import type { ActiveLocks, LockToken } from "../../types";

type LockLogger = (level: "WARN", context: string, message: string, meta?: unknown) => void;

interface CryptoLike {
  randomUUID(): string;
}

interface JobLockDocumentLike {
  ownerToken?: string | null;
}

interface MongoWriteResultLike {
  modifiedCount?: number;
}

interface JobLockModelLike {
  findOneAndUpdate(query: unknown, update: unknown, options: unknown): Promise<JobLockDocumentLike | null>;
  updateOne(query: unknown, update: unknown): Promise<MongoWriteResultLike>;
  deleteOne(query: unknown): Promise<unknown>;
}

interface MongoErrorLike {
  code?: number;
  message?: string;
}

interface LocksContext {
  crypto: CryptoLike;
  JobLockModel: JobLockModelLike;
  logger: LockLogger;
  activeLocks?: ActiveLocks;
  acquireDbLock?: (jobName: string, ttlMs?: number) => Promise<LockToken | null>;
  renewDbLock?: (jobName: string, token: LockToken | null, ttlMs?: number) => Promise<boolean>;
  releaseDbLock?: (jobName: string, token: LockToken | null) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return typeof (err as MongoErrorLike)?.message === "string" ? (err as MongoErrorLike).message : String(err);
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as MongoErrorLike)?.code === 11000;
}

function attachLocks(ctx: LocksContext): void {
  const { crypto, JobLockModel, logger } = ctx;

  const activeLocks: ActiveLocks = new Map();

  async function acquireDbLock(jobName: string, ttlMs = 120000): Promise<LockToken | null> {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMs);
    const lockToken = crypto.randomUUID();
    try {
      const lock = await JobLockModel.findOneAndUpdate(
        { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
        { $set: { lockedUntil: expires, ownerToken: lockToken } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      if (lock && lock.ownerToken === lockToken) {
        activeLocks.set(jobName, lockToken);
        return lockToken;
      }
      return null;
    } catch (err) {
      if (isDuplicateKeyError(err)) return null;
      logger("WARN", "DB_LOCK", "Eroare la obtinerea lock-ului", errorMessage(err));
      return null;
    }
  }

  async function renewDbLock(jobName: string, token: LockToken | null, ttlMs = 120000): Promise<boolean> {
    if (!token) return false;
    const expires = new Date(Date.now() + ttlMs);
    try {
      const res = await JobLockModel.updateOne(
        { _id: `lock_${jobName}`, ownerToken: token },
        { $set: { lockedUntil: expires } }
      );
      return (res.modifiedCount || 0) > 0;
    } catch (err) {
      logger("WARN", "DB_LOCK", "Eroare la reinnoire lock", errorMessage(err));
      return false;
    }
  }

  async function releaseDbLock(jobName: string, token: LockToken | null): Promise<void> {
    if (!token) return;
    try {
      await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
      activeLocks.delete(jobName);
    } catch (err) {
      logger("WARN", "DB_LOCK", "Eroare la eliberare lock", errorMessage(err));
    }
  }

  Object.assign(ctx, {
    activeLocks,
    acquireDbLock,
    renewDbLock,
    releaseDbLock
  });
}

export = attachLocks;
