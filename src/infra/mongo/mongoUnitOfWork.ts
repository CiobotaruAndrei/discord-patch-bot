type UnitOfWorkLogger = (level: string, context: string, message: string, meta?: unknown) => void;

interface CleanupStep {
  describe: string;
  run: () => Promise<unknown>;
}

interface MongoWriteUnit {
  label: string;
  logger: UnitOfWorkLogger;
  critical: Array<() => Promise<unknown>>;
  cleanup?: CleanupStep[];
}

interface MongoTransactionSession {
  withTransaction(work: () => Promise<void>): Promise<void>;
  endSession(): Promise<void>;
}

interface MongoTransactionClient {
  startSession(): Promise<MongoTransactionSession>;
}

interface MongoAtomicWriteUnit extends MongoWriteUnit {
  mongoose?: MongoTransactionClient;
  replicaSetAvailable?: () => boolean;
}

async function runMongoWrite({ label, logger, critical, cleanup }: MongoWriteUnit): Promise<void> {
  for (const step of critical) {
    await step();
  }
  for (const step of cleanup ?? []) {
    try {
      await step.run();
    } catch (err) {
      logger("WARN", "MONGO_UOW",
        `Pas de curatare best-effort esuat in operatia '${label}' (${step.describe}); operatia critica si auditul au reusit deja, curatarea se poate relua idempotent`,
        err instanceof Error ? err.message : String(err));
    }
  }
}

async function runMongoAtomicWrite(unit: MongoAtomicWriteUnit): Promise<void> {
  const client = unit.mongoose;
  const canTransact = Boolean(client && (unit.replicaSetAvailable?.() ?? true));
  if (!canTransact || !client) {
    await runMongoWrite(unit);
    return;
  }
  const session = await client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const step of unit.critical) await step();
    });
    for (const step of unit.cleanup ?? []) {
      try { await step.run(); } catch (err) {
        unit.logger("WARN", "MONGO_UOW", `Curatarea '${step.describe}' a esuat dupa tranzactia '${unit.label}'`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    unit.logger("WARN", "MONGO_UOW", `Tranzactia '${unit.label}' nu este disponibila; se aplica fallback compensatoriu`, err instanceof Error ? err.message : String(err));
    await runMongoWrite(unit);
  } finally {
    await session.endSession();
  }
}

export { runMongoWrite, runMongoAtomicWrite };
export type { MongoWriteUnit, MongoAtomicWriteUnit, CleanupStep, UnitOfWorkLogger };
