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

interface CreateOperationJournalDeps<KindMap> {
  JournalModel: OperationJournalModelLike;
  logger: JournalLogger;
  executors: { readonly [K in keyof KindMap]: OperationExecutor };
  schemaVersions?: { readonly [K in keyof KindMap]?: number };
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

interface OperationJournal<KindMap = Record<string, unknown>> {
  runJournaled<K extends keyof KindMap & string>(key: string, kind: K, payload: KindMap[K], options?: JournaledOperationOptions): Promise<void>;
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

export { OperationAlreadyRunningError, errorText, fallbackVersion };
export type {
  JournalLogger,
  MongoWriteResult,
  OperationJournal,
  OperationJournalDoc,
  OperationJournalModelLike,
  OperationJournalQuery,
  OperationJournalStatus,
  OperationExecutor,
  JournaledOperationOptions,
  CreateOperationJournalDeps,
  RecoverPendingResult
};
