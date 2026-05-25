import type { ActiveLocks, LockToken } from "../../types";
import { errorMessage } from "../../shared/errors";

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
    // V11: nu mai inghitim erorile transient. Catch-ul vechi rescria orice
    // throw (Mongo network blip, replica step-down) intr-un `false`, iar
    // call-site-ul (cron heartbeat) trata `false` ca "lock pierdut definitiv"
    // si anula imediat ciclul. Acum lasam erorile sa propage, ca apelantul sa
    // distinga intre "modifiedCount=0 → lock pierdut, abort" si "throw → blip
    // transient, retry inca o data".
    const res = await JobLockModel.updateOne(
      { _id: `lock_${jobName}`, ownerToken: token },
      { $set: { lockedUntil: expires } }
    );
    return (res.modifiedCount || 0) > 0;
  }

  async function releaseDbLock(jobName: string, token: LockToken | null): Promise<void> {
    if (!token) return;
    // V12: muta `activeLocks.delete` in finally. Inainte, daca deleteOne arunca
    // (Mongo blip in fereastra de release-end-of-cycle), .delete-ul era sarit
    // si intrarea ramanea in activeLocks pe veci (exposed prin metricul
    // `bot_active_locks`). Doc-ul Mongo va expira oricum prin `lockedUntil`,
    // deci tracking-ul in memorie poate fi sters neconditionat — vom recrea
    // entry-ul cand acquireDbLock va prinde un lock proaspat in ciclul urmator.
    try {
      await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
    } catch (err) {
      logger("WARN", "DB_LOCK", "Eroare la eliberare lock", errorMessage(err));
    } finally {
      activeLocks.delete(jobName);
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
