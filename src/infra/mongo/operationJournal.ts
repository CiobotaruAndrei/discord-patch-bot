type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

interface OperationJournalDoc {
  _id: string;
  kind: string;
  payload: unknown;
  status: "pending" | "done";
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

interface OperationJournalModelLike {
  findOne(filter: Record<string, unknown>): { lean(): Promise<OperationJournalDoc | null> };
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): { sort(spec: unknown): { limit(count: number): { lean(): Promise<OperationJournalDoc[]> } } };
}

type OperationExecutor = (payload: unknown) => Promise<void>;

interface CreateOperationJournalDeps {
  JournalModel: OperationJournalModelLike;
  logger: JournalLogger;
  executors: Record<string, OperationExecutor>;
  now?: () => Date;
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createOperationJournal({ JournalModel, logger, executors, now = () => new Date() }: CreateOperationJournalDeps): OperationJournal {
  function executorFor(kind: string): OperationExecutor {
    const executor = executors[kind];
    if (!executor) {
      throw new Error(`operationJournal: nicio functie de executie inregistrata pentru operatia jurnalizata '${kind}'`);
    }
    return executor;
  }

  async function runJournaled(key: string, kind: string, payload: unknown): Promise<void> {
    const executor = executorFor(kind);
    const existing = await JournalModel.findOne({ _id: key }).lean();
    if (existing?.status === "done") return;

    const at = now();
    await JournalModel.updateOne(
      { _id: key },
      { $setOnInsert: { kind, payload, createdAt: at }, $set: { status: "pending", updatedAt: at }, $inc: { attempts: 1 } },
      { upsert: true }
    );

    try {
      await executor(payload);
    } catch (err) {
      logger("WARN", "OP_JOURNAL",
        `Operatia jurnalizata '${kind}' (${key}) a esuat; intrarea ramane 'pending' si va fi reluata idempotent la recovery/retry`,
        errorText(err));
      throw err;
    }

    await JournalModel.updateOne({ _id: key }, { $set: { status: "done", updatedAt: now() } });
  }

  async function recoverPending(options: { olderThanMs: number; limit: number; now?: Date }): Promise<RecoverPendingResult> {
    const at = options.now ?? now();
    const cutoff = new Date(at.getTime() - options.olderThanMs);
    const rows = await JournalModel.find({ status: "pending", updatedAt: { $lte: cutoff } })
      .sort({ updatedAt: 1 }).limit(options.limit).lean();
    const stale = Array.isArray(rows) ? rows : [];
    let recovered = 0;
    let failed = 0;
    for (const entry of stale) {
      const executor = executors[entry.kind];
      if (!executor) {
        failed++;
        logger("WARN", "OP_JOURNAL",
          `Operatie jurnalizata cu 'kind' necunoscut la recovery: '${entry.kind}' (${entry._id}); nu poate fi reluata, ramane 'pending' pentru inspectie manuala`);
        continue;
      }
      try {
        await executor(entry.payload);
        await JournalModel.updateOne({ _id: entry._id }, { $set: { status: "done", updatedAt: now() } });
        recovered++;
        logger("INFO", "OP_JOURNAL", `Operatie recuperata dupa crash: '${entry.kind}' (${entry._id})`);
      } catch (err) {
        failed++;
        await JournalModel.updateOne({ _id: entry._id }, { $set: { updatedAt: now() }, $inc: { attempts: 1 } });
        logger("WARN", "OP_JOURNAL",
          `Recuperarea operatiei jurnalizate '${entry.kind}' (${entry._id}) a esuat; ramane 'pending', se reincearca la urmatorul ciclu de recovery`,
          errorText(err));
      }
    }
    if (recovered > 0 || failed > 0) {
      logger("INFO", "OP_JOURNAL", `Recovery jurnal operatii: ${recovered} recuperate, ${failed} inca in asteptare (din ${stale.length} intrari pending vechi)`);
    }
    return { scanned: stale.length, recovered, failed };
  }

  return { runJournaled, recoverPending };
}

export { createOperationJournal };
export type { OperationJournal, OperationJournalModelLike, OperationExecutor, OperationJournalDoc, CreateOperationJournalDeps, RecoverPendingResult };
