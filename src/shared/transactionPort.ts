"use strict";

export type TransactionSession = { endSession(): Promise<unknown> | unknown };

export type TransactionSupport = "replica-set" | "sharded" | "standalone" | "unknown";

export interface TransactionRunner {
  support(): TransactionSupport;
  atomic<T>(label: string, work: (session: TransactionSession | null) => Promise<T>): Promise<T>;
}

export const sequentialRunner: TransactionRunner = {
  support: () => "unknown",
  atomic: (_label, work) => work(null)
};
