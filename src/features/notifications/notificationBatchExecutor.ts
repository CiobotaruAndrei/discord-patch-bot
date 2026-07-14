"use strict";

import type { OutboundChannel, OutboundHistoryEntry } from "./outboundChannel.js";
import { packEmbedsByBudget, embedCharCost } from "../../shared/discordEmbedChunks.js";
import { buildNotificationContent } from "./notificationTemplate.js";
import { rollbackOrReport, type ReportRollbackFailure, type RollbackFailureContext } from "./rollbackReporter.js";

export interface EmbedBatchSendInput<E> {
  channel: OutboundChannel;
  batch: E[];
  embedOf(entry: E): unknown;
  historyEntryFor(entry: E): OutboundHistoryEntry;
  messageTemplate: string | null | undefined;
  roleId: string | null | undefined;
  maxEmbedsPerMessage: number;
  sendDelayMs: number;
  sleepIfPositive(ms: number): Promise<void>;
  isPermanentDiscordError(err: unknown): boolean;
  transientErrorMessage(err: unknown): string;
  rollbackEntry(entry: E): Promise<unknown>;
  rollbackFailureContext(entry: E): RollbackFailureContext;
  reportRollbackFailure?: ReportRollbackFailure;
  logger: (level: "WARN", context: string, message: string, meta?: unknown) => void;
  onPermanentError(reason: string): Promise<void>;
  onTransientFailure(failed: E[], err: unknown): void;
}

export async function sendEmbedBatch<E>(input: EmbedBatchSendInput<E>): Promise<void> {
  const {
    channel, batch, embedOf, historyEntryFor, messageTemplate, roleId,
    maxEmbedsPerMessage, sendDelayMs, sleepIfPositive,
    isPermanentDiscordError, transientErrorMessage,
    rollbackEntry, rollbackFailureContext, reportRollbackFailure, logger, onPermanentError, onTransientFailure
  } = input;
  const messageChunks = packEmbedsByBudget(batch, entry => embedCharCost(embedOf(entry)), { maxCount: maxEmbedsPerMessage });
  for (let ci = 0; ci < messageChunks.length; ci++) {
    const chunk = messageChunks[ci];
    const sendPayload: Record<string, unknown> = { embeds: chunk.map(embedOf) };
    if (ci === 0) {
      Object.assign(sendPayload, buildNotificationContent(messageTemplate, { count: batch.length }, roleId || null));
    }
    try {
      await channel.send(sendPayload, { historyEntries: chunk.map(historyEntryFor) });
      await sleepIfPositive(sendDelayMs);
    } catch (err: unknown) {
      const failed = messageChunks.slice(ci).reduce<E[]>((acc, c) => { for (const entry of c) acc.push(entry); return acc; }, []);
      for (const entry of failed) {
        await rollbackOrReport(() => rollbackEntry(entry), logger, rollbackFailureContext(entry), reportRollbackFailure);
      }
      if (isPermanentDiscordError(err)) {
        await onPermanentError(`Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`);
        return;
      }
      onTransientFailure(failed, err);
      return;
    }
  }
}
