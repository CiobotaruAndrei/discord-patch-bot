import crypto from "node:crypto";

type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

type OperationJournalStatus = "pending" | "leased" | "done";

interface OperationJournalDoc {
  _id: string;
  kind: string;
  payload: unknown;
  status: OperationJournalStatus;
  attempts: number;
  leaseVersion: number;
  lockedBy?: string | null;
  lockedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoWriteResult {
  matchedCount?: number;
  modifiedCount?: number;
}

interface OperationJournalQuery {
  lean(): Promise<OperationJournalDoc | null>;
}

interface OperationJournalModelLike {
  findOne(filter: Record<string, unknown>): OperationJournalQuery;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>
  ): OperationJournalQuery;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<MongoWriteResult>;
  find(filter: Record<string, unknown>): {
    sort(spec: unknown): { limit(count: number): { lean(): Promise<OperationJournalDoc[]> } };
  };
}

type OperationExecutor = (payload: unknown, operationId: string) => Promise<void>;

interface CreateOperationJournalDeps {
  JournalModel: OperationJournalModelLike;
  logger: JournalLogger;
  executors: Record<string, OperationExecutor>;
  now?: () => Date;
  ownerId?: string;
  leaseMs?: number;
}

interface RecoverPendingResult {
  scanned: number;
  recovered: number;
  failed: number;
}

interface OperationJournal {
  runJournaled(key: string, kind: string, payload: unknown): Promise<void>;
  recoverPending(options: { olderThanMs: number; limit: number; now?: Date }): Promise<RecoverPendingResult>;
}

class OperationAlreadyRunningError extends Error {
  constructor(key: string) {
    super(`Operatia jurnalizata '${key}' este deja executata de alta instanta`);
    this.name = "OperationAlreadyRunningError";
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createOperationJournal({
  JournalModel,
  logger,
  executors,
  now = () => new Date(),
  ownerId = crypto.randomUUID(),
  leaseMs = 5 * 60 * 1000
}: CreateOperationJournalDeps): OperationJournal {
  function executorFor(kind: string): OperationExecutor {
    const executor = executors[kind];
    if (!executor) {
      throw new Error(`operationJournal: nicio functie de executie inregistrata pentru operatia jurnalizata '${kind}'`);
    }
    return executor;
  }

  function leaseGuard(entry: OperationJournalDoc): Record<string, unknown> {
    return {
      _id: entry._id,
      status: "leased",
      lockedBy: ownerId,
      leaseVersion: entry.leaseVersion
    };
  }

  async function ensurePending(key: string, kind: string, payload: unknown, at: Date): Promise<void> {
    await JournalModel.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          kind,
          payload,
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
        status: { $ne: "done" },
        $or: [
          { status: "pending" },
          { status: "leased", lockedUntil: { $lte: at } }
        ]
      },
      {
        $set: { status: "leased", lockedBy: ownerId, lockedUntil, updatedAt: at },
        $inc: { attempts: 1, leaseVersion: 1 }
      },
      { new: true }
    ).lean();
  }

  async function releaseForRetry(entry: OperationJournalDoc): Promise<void> {
    await JournalModel.updateOne(
      leaseGuard(entry),
      {
        $set: { status: "pending", lockedBy: null, lockedUntil: null, updatedAt: now() }
      }
    );
  }

  async function markDone(entry: OperationJournalDoc): Promise<void> {
    const result = await JournalModel.updateOne(
      leaseGuard(entry),
      {
        $set: { status: "done", lockedBy: null, lockedUntil: null, updatedAt: now() }
      }
    );
    if ((result.modifiedCount ?? result.matchedCount ?? 0) === 0) {
      throw new Error(`operationJournal: lease pierdut inainte de finalizarea operatiei '${entry._id}'`);
    }
  }

  async function executeClaimed(entry: OperationJournalDoc, executor: OperationExecutor): Promise<void> {
    try {
      await executor(entry.payload, entry._id);
      await markDone(entry);
    } catch (err) {
      await releaseForRetry(entry);
      throw err;
    }
  }

  async function runJournaled(key: string, kind: string, payload: unknown): Promise<void> {
    const executor = executorFor(kind);
    const at = now();
    await ensurePending(key, kind, payload, at);
    const entry = await claim(key, at);
    if (!entry) {
      const existing = await JournalModel.findOne({ _id: key }).lean();
      if (existing?.status === "done") return;
      throw new OperationAlreadyRunningError(key);
    }
    if (entry.kind !== kind) {
      await releaseForRetry(entry);
      throw new Error(`operationJournal: cheia '${key}' este deja asociata operatiei '${entry.kind}', nu '${kind}'`);
    }
    try {
      await executeClaimed(entry, executor);
    } catch (err) {
      logger(
        "WARN",
        "OP_JOURNAL",
        `Operatia jurnalizata '${kind}' (${key}) a esuat; lease-ul a fost eliberat pentru recovery/retry`,
        errorText(err)
      );
      throw err;
    }
  }

  async function recoverPending(options: { olderThanMs: number; limit: number; now?: Date }): Promise<RecoverPendingResult> {
    const at = options.now ?? now();
    const cutoff = new Date(at.getTime() - options.olderThanMs);
    const rows = await JournalModel.find({
      status: { $ne: "done" },
      $or: [
        { status: "pending", updatedAt: { $lte: cutoff } },
        { status: "leased", lockedUntil: { $lte: at } }
      ]
    }).sort({ updatedAt: 1 }).limit(options.limit).lean();
    const stale = Array.isArray(rows) ? rows : [];
    let recovered = 0;
    let failed = 0;
    for (const candidate of stale) {
      const entry = await claim(candidate._id, at);
      if (!entry) continue;
      const executor = executors[entry.kind];
      if (!executor) {
        failed++;
        await releaseForRetry(entry);
        logger(
          "WARN",
          "OP_JOURNAL",
          `Operatie jurnalizata cu 'kind' necunoscut la recovery: '${entry.kind}' (${entry._id})`
        );
        continue;
      }
      try {
        await executeClaimed(entry, executor);
        recovered++;
        logger("INFO", "OP_JOURNAL", `Operatie recuperata dupa crash: '${entry.kind}' (${entry._id})`);
      } catch (err) {
        failed++;
        logger(
          "WARN",
          "OP_JOURNAL",
          `Recuperarea operatiei jurnalizate '${entry.kind}' (${entry._id}) a esuat; lease-ul a fost eliberat`,
          errorText(err)
        );
      }
    }
    if (recovered > 0 || failed > 0) {
      logger(
        "INFO",
        "OP_JOURNAL",
        `Recovery jurnal operatii: ${recovered} recuperate, ${failed} inca in asteptare (din ${stale.length} candidate)`
      );
    }
    return { scanned: stale.length, recovered, failed };
  }

  return { runJournaled, recoverPending };
}

export { createOperationJournal, OperationAlreadyRunningError };
export type {
  OperationJournal,
  OperationJournalModelLike,
  OperationExecutor,
  OperationJournalDoc,
  OperationJournalStatus,
  CreateOperationJournalDeps,
  RecoverPendingResult
};
