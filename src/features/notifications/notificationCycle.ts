"use strict";

import { matchedDocument } from "../../shared/persistenceOutcome.js";
import { cronContextFor, type NotificationKind } from "../../shared/notificationKinds.js";
import { sendEmbedBatch } from "./notificationBatchExecutor.js";
import { rollbackOrReport, type ReportRollbackFailure } from "./rollbackReporter.js";
import type { NotificationEmbed } from "./notificationTypes.js";
import type { OutboundChannel, OutboundHistoryEntry } from "./outboundChannel.js";

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

export interface NotificationCycleEnvironment {
  logger: Logger;
  isPermanentDiscordError: (err: unknown) => boolean;
  transientErrorMessage: (err: unknown) => string;
  sleepIfPositive: (ms: number) => Promise<void>;
  reportRollbackFailure?: ReportRollbackFailure;
  maxEmbedsPerMessage: number;
  sendDelayMs: number;
}

export interface CycleItemIdentity {
  itemId: string;
  describe: string;
  history: Omit<OutboundHistoryEntry, "kind">;
}

export interface GuildNotificationCycle<Candidate> {
  kind: NotificationKind;
  guildId: string;
  channel: OutboundChannel;
  limit: number;
  candidates?: readonly Candidate[];
  pull?: () => Candidate | null;
  identify: (candidate: Candidate) => CycleItemIdentity;
  claim: (candidate: Candidate) => Promise<ClaimOutcome>;
  buildEmbed: (candidate: Candidate) => NotificationEmbed | Promise<NotificationEmbed>;
  releaseClaim: (candidate: Candidate) => Promise<unknown>;
  disableChannel?: (reason: string) => Promise<unknown>;
  claimFailureIsPermanent?: (err: unknown) => boolean;
  onClaimFailure?: (candidate: Candidate, err: unknown) => void | Promise<void>;
  onSendFailure?: (failed: readonly Candidate[], err: unknown) => void;
  transientPolicy?: TransientFailurePolicy;
  messageTemplate?: string | null;
  roleId?: string | null;
  persist?: (outcome: CycleOutcome<Candidate>) => Promise<void>;
}

export interface CycleOutcome<Candidate> {
  claimed: number;
  unclaimed: Candidate[];
  channelDisabled: boolean;
}

export async function runGuildNotificationCycle<Candidate>(
  environment: NotificationCycleEnvironment,
  cycle: GuildNotificationCycle<Candidate>
): Promise<CycleOutcome<Candidate>> {
  const { logger, isPermanentDiscordError, transientErrorMessage, reportRollbackFailure } = environment;
  const context = cronContextFor(cycle.kind);
  const { guildId, channel } = cycle;
  let channelDisabled = false;

  function contextOf(candidate: Candidate) {
    return { guildId, kind: cycle.kind, itemId: cycle.identify(candidate).itemId };
  }

  function release(candidate: Candidate): Promise<void> {
    return rollbackOrReport(() => cycle.releaseClaim(candidate), logger, contextOf(candidate), reportRollbackFailure);
  }

  async function disableChannel(reason: string): Promise<void> {
    channelDisabled = true;
    if (cycle.disableChannel) await cycle.disableChannel(reason).catch(() => null);
    logger("WARN", context, `Notificarile ${cycle.kind} sunt oprite pentru guild ${guildId} - cod permanent de la Discord`, reason);
  }

  type Entry = { candidate: Candidate; embed: NotificationEmbed };

  const claimed = await claimIntoBatch<Candidate, Entry>({
    candidates: cycle.candidates,
    pull: cycle.pull,
    limit: cycle.limit,
    context,
    logger,
    claim: cycle.claim,
    prepare: async candidate => ({ candidate, embed: await cycle.buildEmbed(candidate) }),
    rollback: release,
    describe: candidate => cycle.identify(candidate).describe,
    isPermanentError: cycle.claimFailureIsPermanent ?? isPermanentDiscordError,
    onPermanentError: err => disableChannel(`Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`),
    onTransientError: cycle.onClaimFailure,
    transientPolicy: cycle.transientPolicy,
    errorMessage: transientErrorMessage
  });

  if (claimed.batch.length && !claimed.stopped) {
    await sendEmbedBatch<Entry>({
      channel,
      batch: claimed.batch,
      embedOf: entry => entry.embed,
      historyEntryFor: entry => ({ kind: cycle.kind, ...cycle.identify(entry.candidate).history }),
      messageTemplate: cycle.messageTemplate,
      roleId: cycle.roleId,
      maxEmbedsPerMessage: environment.maxEmbedsPerMessage,
      sendDelayMs: environment.sendDelayMs,
      sleepIfPositive: environment.sleepIfPositive,
      isPermanentDiscordError,
      transientErrorMessage,
      rollbackEntry: entry => cycle.releaseClaim(entry.candidate),
      rollbackFailureContext: entry => contextOf(entry.candidate),
      reportRollbackFailure,
      logger,
      onPermanentError: disableChannel,
      onTransientFailure: (failed, err) => {
        cycle.onSendFailure?.(failed.map(entry => entry.candidate), err);
        logger("WARN", context, `Nu am putut trimite notificarile ${cycle.kind} pentru guild ${guildId}`, transientErrorMessage(err));
      }
    });
  }

  const outcome: CycleOutcome<Candidate> = {
    claimed: claimed.stopped ? 0 : claimed.batch.length,
    unclaimed: claimed.remaining,
    channelDisabled
  };
  if (cycle.persist) await cycle.persist(outcome);
  return outcome;
}
