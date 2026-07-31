import crypto from "node:crypto";

import { OperationAlreadyRunningError, errorText } from "./operationJournalContracts.js";
import { createOperationJournalStore } from "./operationJournalStore.js";
import { createOperationExecution } from "./operationJournalExecution.js";
import { createOperationRecovery } from "./operationJournalRecovery.js";

import type {
  CreateOperationJournalDeps,
  JournaledOperationOptions,
  OperationExecutor,
  OperationJournal
} from "./operationJournalContracts.js";

function createOperationJournal<KindMap extends Record<string, unknown> = Record<string, unknown>>({
  JournalModel,
  logger,
  executors,
  schemaVersions,
  now = () => new Date(),
  ownerId = crypto.randomUUID(),
  leaseMs = 5 * 60 * 1000,
  maxAttempts = 5
}: CreateOperationJournalDeps<KindMap>): OperationJournal<KindMap> {
  const executorTable = new Map<string, OperationExecutor>(Object.entries(executors));
  const schemaVersionTable = new Map<string, number | undefined>(Object.entries(schemaVersions ?? {}));
  const schemaVersionFor = (kind: string): number => schemaVersionTable.get(kind) ?? 1;

  function executorFor(kind: string): OperationExecutor {
    const executor = executorTable.get(kind);
    if (!executor) {
      throw new Error(`operationJournal: nicio functie de executie inregistrata pentru operatia jurnalizata '${kind}'`);
    }
    return executor;
  }

  const store = createOperationJournalStore({ JournalModel, now, ownerId, leaseMs, maxAttempts, schemaVersionFor });
  const execution = createOperationExecution({ store, now, leaseMs, schemaVersionFor });
  const recovery = createOperationRecovery({
    store,
    execution,
    logger,
    now,
    maxAttempts,
    executorFor: kind => executorTable.get(kind)
  });

  async function runJournaled<K extends keyof KindMap & string>(key: string, kind: K, payload: KindMap[K], options?: JournaledOperationOptions): Promise<void> {
    const executor = executorFor(kind);
    const at = now();
    await store.ensurePending(key, kind, payload, at, options);
    const entry = await store.claim(key, at);
    if (!entry) {
      const existing = await store.readEntry(key);
      if (existing && ["done", "superseded"].includes(existing.status)) return;
      if (existing?.status === "failed") throw new Error(`operationJournal: operatia '${key}' a esuat definitiv`);
      throw new OperationAlreadyRunningError(key);
    }
    if (entry.kind !== kind) {
      await store.releaseAfterFailure(entry, new Error(`kind incompatibil: ${kind}`));
      throw new Error(`operationJournal: cheia '${key}' este deja asociata operatiei '${entry.kind}', nu '${kind}'`);
    }
    try {
      await execution.executeClaimed(entry, executor);
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

  return { runJournaled, recoverPending: recovery.recoverPending };
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
} from "./operationJournalContracts.js";
