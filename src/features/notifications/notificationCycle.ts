"use strict";

import { matchedDocument } from "../../shared/persistenceOutcome.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export type ClaimOutcome = { matchedCount?: number };

export type TransientFailurePolicy = "continue" | "stop";

export type ClaimBatchOptions<Candidate, Entry> = {
  candidates?: readonly Candidate[];
  pull?: () => Candidate | null;
  limit: number;
  context: string;
  logger: Logger;
  claim: (candidate: Candidate) => Promise<ClaimOutcome>;
  prepare: (candidate: Candidate) => Entry | Promise<Entry>;
  rollback: (candidate: Candidate) => Promise<void>;
  describe: (candidate: Candidate) => string;
  isPermanentError: (err: unknown) => boolean;
  onPermanentError: (err: unknown) => Promise<void>;
  onTransientError?: (candidate: Candidate, err: unknown) => Promise<void> | void;
  transientPolicy?: TransientFailurePolicy;
  errorMessage: (err: unknown) => string;
};

export type ClaimBatchResult<Candidate, Entry> = {
  batch: Entry[];
  stopped: boolean;
  remaining: Candidate[];
};

export async function claimIntoBatch<Candidate, Entry>(
  options: ClaimBatchOptions<Candidate, Entry>
): Promise<ClaimBatchResult<Candidate, Entry>> {
  const batch: Entry[] = [];
  const list = options.candidates ?? [];
  const policy = options.transientPolicy ?? "continue";
  let index = 0;

  function takeNext(): Candidate | null {
    if (options.pull) return options.pull();
    if (index >= list.length) return null;
    const candidate = list[index];
    index += 1;
    return candidate ?? null;
  }

  function remainingCandidates(): Candidate[] {
    return options.pull ? [] : list.slice(index);
  }

  while (batch.length < options.limit) {
    const candidate = takeNext();
    if (candidate === null) break;

    let claimed = false;
    try {
      const outcome = await options.claim(candidate);
      if (!matchedDocument(outcome)) continue;
      claimed = true;
      batch.push(await options.prepare(candidate));
    } catch (err: unknown) {
      if (claimed) await options.rollback(candidate);
      if (options.isPermanentError(err)) {
        await options.onPermanentError(err);
        return { batch, stopped: true, remaining: [] };
      }
      await options.onTransientError?.(candidate, err);
      options.logger(
        "WARN",
        options.context,
        `Nu am putut revendica ${options.describe(candidate)}`,
        options.errorMessage(err)
      );
      if (policy === "stop") return { batch, stopped: false, remaining: remainingCandidates() };
    }
  }

  return { batch, stopped: false, remaining: remainingCandidates() };
}
