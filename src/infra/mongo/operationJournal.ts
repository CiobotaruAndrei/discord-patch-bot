import crypto from "node:crypto";

type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

type OperationJournalStatus = "pending" | "leased" | "done" | "superseded" | "failed";

interface OperationJournalDoc {
  _id: string;
  kind: string;
  payload: unknown;
  schemaVersion: number;
  resourceKey: string;
  resourceVersion: string;
  status: OperationJournalStatus;
  attempts: number;
  leaseVersion: number;
  lockedBy?: string | null;
  lockedUntil?: Date | null;
  lastError?: string | null;
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

interface JournaledOperationOptions {
  schemaVersion: number;
  resourceKey: string;
  resourceVersion: string;
}

interface CreateOperationJournalDeps {
  JournalModel: OperationJournalModelLike;
  logger: JournalLogger;
  executors: Record<string, OperationExecutor>;
  schemaVersions?: Record<string, number>;
  now?: () => Date;
  ownerId?: string;
  leaseMs?: number;
  maxAttempts?: number;
}

interface RecoverPendingResult {
  scanned: number;
  recovered: number;
  failed: number;
  superseded: number;
}

interface OperationJournal {
  runJournaled(key: string, kind: string, payload: unknown, options?: JournaledOperationOptions): Promise<void>;
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

function fallbackVersion(at: Date, key: string): string {
  return `${String(at.getTime()).padStart(20, "0")}:${key}`;
}

function createOperationJournal({
  JournalModel,
  logger,
  executors,
  schemaVersions = {},
  now = () => new Date(),
  ownerId = crypto.randomUUID(),
  leaseMs = 5 * 60 * 1000,
  maxAttempts = 5
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

  async function ensurePending(key: string, kind: string, payload: unknown, at: Date, options?: JournaledOperationOptions): Promise<void> {
    await JournalModel.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          kind,
          payload,
          schemaVersion: options?.schemaVersion ?? schemaVersions[kind] ?? 1,
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
      { new: true }
    ).lean();
  }

  async function markTerminal(entry: OperationJournalDoc, status: "done" | "superseded" | "failed", lastError: string | null = null): Promise<void> {
    const result = await JournalModel.updateOne(
      leaseGuard(entry),
      {
        $set: { status, lastError, lockedBy: null, lockedUntil: null, updatedAt: now() }
      }
    );
    if ((result.modifiedCount ?? result.matchedCount ?? 0) === 0) {
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

  async function executeClaimed(entry: OperationJournalDoc, executor: OperationExecutor): Promise<"done" | "superseded"> {
    const expectedSchemaVersion = schemaVersions[entry.kind] ?? 1;
    if (entry.schemaVersion !== expectedSchemaVersion) {
      await markTerminal(entry, "failed", `schemaVersion incompatibila: ${entry.schemaVersion}, asteptat ${expectedSchemaVersion}`);
      throw new Error(`operationJournal: schemaVersion incompatibila pentru '${entry.kind}' (${entry._id})`);
    }
    if (typeof entry.resourceKey !== "string" || entry.resourceKey.length === 0
      || typeof entry.resourceVersion !== "string" || entry.resourceVersion.length === 0) {
      const reason = "Metadatele de versiune ale resursei lipsesc; operatia nu poate fi reluata in siguranta";
      await markTerminal(entry, "failed", reason);
      throw new Error(`operationJournal: versiune de resursa lipsa pentru '${entry._id}'`);
    }
    if (await supersededByNewerOperation(entry)) {
      await markTerminal(entry, "superseded", "Exista o operatie mai noua pentru aceeasi resursa");
      return "superseded";
    }

    let leaseLost = false;
    const heartbeatEveryMs = Math.max(100, Math.floor(leaseMs / 3));
    const heartbeat = setInterval(() => {
      const at = now();
      void JournalModel.updateOne(
        leaseGuard(entry),
        { $set: { lockedUntil: new Date(at.getTime() + leaseMs), updatedAt: at } }
      ).then(result => {
        if ((result.modifiedCount ?? result.matchedCount ?? 0) === 0) leaseLost = true;
      }).catch(() => { leaseLost = true; });
    }, heartbeatEveryMs);
    if (typeof heartbeat.unref === "function") heartbeat.unref();
    try {
      await executor(entry.payload, entry._id);
      if (leaseLost) throw new Error(`operationJournal: lease pierdut in timpul operatiei '${entry._id}'`);
      await markTerminal(entry, "done");
      return "done";
    } catch (err) {
      if (!leaseLost) await releaseAfterFailure(entry, err);
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function runJournaled(key: string, kind: string, payload: unknown, options?: JournaledOperationOptions): Promise<void> {
    const executor = executorFor(kind);
    const at = now();
    await ensurePending(key, kind, payload, at, options);
    const entry = await claim(key, at);
    if (!entry) {
      const existing = await JournalModel.findOne({ _id: key }).lean();
      if (existing && ["done", "superseded"].includes(existing.status)) return;
      if (existing?.status === "failed") throw new Error(`operationJournal: operatia '${key}' a esuat definitiv`);
      throw new OperationAlreadyRunningError(key);
    }
    if (entry.kind !== kind) {
      await releaseAfterFailure(entry, new Error(`kind incompatibil: ${kind}`));
      throw new Error(`operationJournal: cheia '${key}' este deja asociata operatiei '${entry.kind}', nu '${kind}'`);
    }
    try {
      await executeClaimed(entry, executor);
    } catch (err) {
      logger(
        "WARN",
        "OP_JOURNAL",
        `Operatia jurnalizata '${kind}' (${key}) a esuat`,
        errorText(err)
      );
      throw err;
    }
  }

  async function failUnclaimed(candidate: OperationJournalDoc, reason: string, at: Date): Promise<void> {
    await JournalModel.updateOne(
      { _id: candidate._id, status: candidate.status, leaseVersion: candidate.leaseVersion },
      { $set: { status: "failed", lastError: reason, lockedBy: null, lockedUntil: null, updatedAt: at } }
    );
  }

  async function recoverPending(options: { olderThanMs: number; limit: number; now?: Date }): Promise<RecoverPendingResult> {
    const at = options.now ?? now();
    const cutoff = new Date(at.getTime() - options.olderThanMs);
    const rows = await JournalModel.find({
      $or: [
        { status: "pending", updatedAt: { $lte: cutoff } },
        { status: "leased", lockedUntil: { $lte: at } }
      ]
    }).sort({ updatedAt: 1 }).limit(options.limit).lean();
    const stale = Array.isArray(rows) ? rows : [];
    let recovered = 0;
    let failed = 0;
    let superseded = 0;
    for (const candidate of stale) {
      if (candidate.attempts >= maxAttempts) {
        await failUnclaimed(candidate, `Numarul maxim de incercari (${maxAttempts}) a fost atins`, at);
        failed++;
        continue;
      }
      const entry = await claim(candidate._id, at);
      if (!entry) continue;
      const executor = executors[entry.kind];
      if (!executor) {
        failed++;
        await markTerminal(entry, "failed", `Executor necunoscut pentru '${entry.kind}'`);
        logger("WARN", "OP_JOURNAL", `Operatie jurnalizata cu 'kind' necunoscut la recovery: '${entry.kind}' (${entry._id})`);
        continue;
      }
      try {
        const outcome = await executeClaimed(entry, executor);
        if (outcome === "superseded") superseded++;
        else recovered++;
      } catch (err) {
        failed++;
        logger("WARN", "OP_JOURNAL", `Recuperarea operatiei jurnalizate '${entry.kind}' (${entry._id}) a esuat`, errorText(err));
      }
    }
    if (recovered > 0 || failed > 0 || superseded > 0) {
      logger("INFO", "OP_JOURNAL", `Recovery jurnal operatii: ${recovered} recuperate, ${superseded} depasite, ${failed} esuate (din ${stale.length} candidate)`);
    }
    return { scanned: stale.length, recovered, failed, superseded };
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
  JournaledOperationOptions,
  CreateOperationJournalDeps,
  RecoverPendingResult
};
