import { errorText } from "./operationJournalContracts.js";

import type { JournalLogger, OperationExecutor, RecoverPendingResult } from "./operationJournalContracts.js";
import type { OperationExecution } from "./operationJournalExecution.js";
import type { OperationJournalStore } from "./operationJournalStore.js";

interface OperationRecoveryDeps {
  store: OperationJournalStore;
  execution: OperationExecution;
  logger: JournalLogger;
  now: () => Date;
  maxAttempts: number;
  executorFor: (kind: string) => OperationExecutor | undefined;
}

function createOperationRecovery(deps: OperationRecoveryDeps) {
  const { store, execution, logger, maxAttempts } = deps;

  async function recoverPending(options: { olderThanMs: number; limit: number; now?: Date }): Promise<RecoverPendingResult> {
    const at = options.now ?? deps.now();
    const stale = await store.listStale(at, options.olderThanMs, options.limit);
    let recovered = 0;
    let failed = 0;
    let superseded = 0;
    for (const candidate of stale) {
      if (candidate.attempts >= maxAttempts) {
        await store.failUnclaimed(candidate, `Numarul maxim de incercari (${maxAttempts}) a fost atins`, at);
        failed++;
        continue;
      }
      const entry = await store.claim(candidate._id, at);
      if (!entry) continue;
      const executor = deps.executorFor(entry.kind);
      if (!executor) {
        failed++;
        await store.markTerminal(entry, "failed", `Executor necunoscut pentru '${entry.kind}'`);
        logger("WARN", "OP_JOURNAL", `Operatie jurnalizata cu 'kind' necunoscut la recovery: '${entry.kind}' (${entry._id})`);
        continue;
      }
      try {
        const outcome = await execution.executeClaimed(entry, executor);
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

  return { recoverPending };
}

export { createOperationRecovery };
export type { OperationRecoveryDeps };
