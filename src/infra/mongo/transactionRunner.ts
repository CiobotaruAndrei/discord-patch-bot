"use strict";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type SessionLike = {
  endSession(): Promise<unknown> | unknown;
  withTransaction?(fn: () => Promise<void>): Promise<unknown>;
};

type MongooseLike = {
  startSession?: () => Promise<SessionLike>;
  connection?: {
    db?: { admin(): { command(cmd: Record<string, unknown>): Promise<Record<string, unknown>> } } | null;
  };
};

export type TransactionSupport = "replica-set" | "sharded" | "standalone" | "unknown";

export type TransactionRunner = {
  support: () => TransactionSupport;
  atomic: <T>(label: string, work: (session: SessionLike | null) => Promise<T>) => Promise<T>;
};

export async function detectTransactionSupport(mongoose: MongooseLike): Promise<TransactionSupport> {
  const admin = mongoose.connection?.db?.admin?.();
  if (!admin) return "unknown";
  try {
    const hello = await admin.command({ hello: 1 });
    if (typeof hello.setName === "string" && hello.setName.length > 0) return "replica-set";
    if (hello.msg === "isdbgrid") return "sharded";
    return "standalone";
  } catch {
    return "unknown";
  }
}

export function createTransactionRunner(
  mongoose: MongooseLike,
  support: TransactionSupport,
  logger: Logger
): TransactionRunner {
  const transactional = support === "replica-set" || support === "sharded";

  return {
    support: () => support,
    async atomic<T>(label: string, work: (session: SessionLike | null) => Promise<T>): Promise<T> {
      if (!transactional || typeof mongoose.startSession !== "function") {
        return await work(null);
      }
      const session = await mongoose.startSession();
      if (typeof session.withTransaction !== "function") {
        await session.endSession();
        return await work(null);
      }
      try {
        let outcome: T | undefined;
        let captured = false;
        await session.withTransaction(async () => {
          outcome = await work(session);
          captured = true;
        });
        if (!captured) throw new Error(`tranzactia '${label}' s-a incheiat fara sa produca un rezultat`);
        return outcome as T;
      } catch (err) {
        logger("WARN", "MONGO_TX", `Tranzactia '${label}' a esuat; jurnalul de operatii ramane calea de recuperare`, err);
        throw err;
      } finally {
        await session.endSession();
      }
    }
  };
}
