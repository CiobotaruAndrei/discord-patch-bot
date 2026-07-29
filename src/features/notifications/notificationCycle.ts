"use strict";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

export type ClaimOutcome = { matchedCount?: number };

export type ClaimBatchOptions<Candidate, Entry> = {
  candidates: readonly Candidate[];
  limit: number;
  context: string;
  logger: Logger;
  claim: (candidate: Candidate) => Promise<ClaimOutcome>;
  entryOf: (candidate: Candidate) => Entry;
  rollback: (candidate: Candidate) => Promise<void>;
  describe: (candidate: Candidate) => string;
  isPermanentError: (err: unknown) => boolean;
  onPermanentError: (err: unknown) => Promise<void>;
  errorMessage: (err: unknown) => string;
};

export type ClaimBatchResult<Entry> = {
  batch: Entry[];
  stopped: boolean;
};

export async function claimIntoBatch<Candidate, Entry>(
  options: ClaimBatchOptions<Candidate, Entry>
): Promise<ClaimBatchResult<Entry>> {
  const batch: Entry[] = [];

  for (const candidate of options.candidates) {
    if (batch.length >= options.limit) break;

    let claimed = false;
    try {
      const outcome = await options.claim(candidate);
      if ((outcome.matchedCount ?? 0) === 0) continue;
      claimed = true;
      batch.push(options.entryOf(candidate));
    } catch (err: unknown) {
      if (claimed) {
        await options.rollback(candidate);
      }
      if (options.isPermanentError(err)) {
        await options.onPermanentError(err);
        return { batch, stopped: true };
      }
      options.logger(
        "WARN",
        options.context,
        `Nu am putut revendica ${options.describe(candidate)}`,
        options.errorMessage(err)
      );
    }
  }

  return { batch, stopped: false };
}
