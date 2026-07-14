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

export { runMongoWrite };
export type { MongoWriteUnit, CleanupStep, UnitOfWorkLogger };
