import type { OperationExecutor, OperationJournalDoc } from "./operationJournalContracts.js";
import type { OperationJournalStore } from "./operationJournalStore.js";

interface OperationExecutionDeps {
  store: OperationJournalStore;
  now: () => Date;
  leaseMs: number;
  schemaVersionFor: (kind: string) => number;
}

function createOperationExecution(deps: OperationExecutionDeps) {
  const { store, now, leaseMs } = deps;

  async function rejectIncompatible(entry: OperationJournalDoc): Promise<void> {
    const expectedSchemaVersion = deps.schemaVersionFor(entry.kind);
    if (entry.schemaVersion !== expectedSchemaVersion) {
      await store.markTerminal(entry, "failed", `schemaVersion incompatibila: ${entry.schemaVersion}, asteptat ${expectedSchemaVersion}`);
      throw new Error(`operationJournal: schemaVersion incompatibila pentru '${entry.kind}' (${entry._id})`);
    }
    if (typeof entry.resourceKey !== "string" || entry.resourceKey.length === 0
      || typeof entry.resourceVersion !== "string" || entry.resourceVersion.length === 0) {
      const reason = "Metadatele de versiune ale resursei lipsesc; operatia nu poate fi reluata in siguranta";
      await store.markTerminal(entry, "failed", reason);
      throw new Error(`operationJournal: versiune de resursa lipsa pentru '${entry._id}'`);
    }
  }

  function startHeartbeat(entry: OperationJournalDoc): { stop: () => void; lost: () => boolean } {
    let leaseLost = false;
    let inFlight = false;
    const everyMs = Math.max(100, Math.floor(leaseMs / 3));
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void store.renewLease(entry, now()).then(renewed => {
        if (!renewed) leaseLost = true;
        inFlight = false;
      }).catch(() => {
        leaseLost = true;
        inFlight = false;
      });
    }, everyMs);
    if (typeof timer.unref === "function") timer.unref();
    return { stop: () => { clearInterval(timer); }, lost: () => leaseLost };
  }

  async function executeClaimed(entry: OperationJournalDoc, executor: OperationExecutor): Promise<"done" | "superseded"> {
    await rejectIncompatible(entry);
    if (await store.supersededByNewerOperation(entry)) {
      await store.markTerminal(entry, "superseded", "Exista o operatie mai noua pentru aceeasi resursa");
      return "superseded";
    }

    const heartbeat = startHeartbeat(entry);
    try {
      await executor(entry.payload, entry._id);
      if (heartbeat.lost()) throw new Error(`operationJournal: lease pierdut in timpul operatiei '${entry._id}'`);
      await store.markTerminal(entry, "done");
      return "done";
    } catch (err) {
      if (!heartbeat.lost()) await store.releaseAfterFailure(entry, err);
      throw err;
    } finally {
      heartbeat.stop();
    }
  }

  return { executeClaimed };
}

type OperationExecution = ReturnType<typeof createOperationExecution>;

export { createOperationExecution };
export type { OperationExecution, OperationExecutionDeps };
