"use strict";

export type RollbackLogger = (level: "WARN", context: string, message: string, meta?: unknown) => void;

export interface RollbackFailureContext {
  guildId: string;
  kind: string;
  itemId: string;
}

export type ReportRollbackFailure = (context: RollbackFailureContext, error: unknown) => void | Promise<void>;

export async function rollbackOrReport(
  rollback: () => Promise<unknown>,
  logger: RollbackLogger,
  context: RollbackFailureContext,
  report?: ReportRollbackFailure
): Promise<void> {
  try {
    await rollback();
  } catch (error) {
    logger(
      "WARN",
      "ROLLBACK",
      `Anularea (rollback) revendicarii a esuat pentru ${context.kind} ${context.itemId} (guild ${context.guildId}); elementul poate ramane marcat ca vazut si sa nu mai fie re-livrat - investigheaza si curata manual`,
      error instanceof Error ? error.message : String(error)
    );
    if (report) await report(context, error);
  }
}
