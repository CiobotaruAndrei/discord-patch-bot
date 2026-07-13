"use strict";

export interface OutboxDeliveryJob {
  channelId: string;
  payload: unknown;
  dedupeKey?: string;
  deliveries?: number;
  recoveryVerify?: boolean;
}

import type { OutboxDiscordClient } from "./outboundChannel.js";
import { isSendableChannel } from "./outboundChannel.js";

export type OutboxDeliveryClient = OutboxDiscordClient;

export type OutboxDeliveryResult =
  | { ok: true; recoveryFetched?: boolean; recoveryDuplicate?: boolean; recoveryFailed?: boolean; recoveryMarkerMissing?: boolean }
  | { ok: false; permanent: boolean; recoveryFailed?: boolean };

export interface OutboxDeliveryDeps {
  canSendEmbeds: (channel: unknown, botId: string) => boolean;
  isPermanentDiscordError: (err: unknown) => boolean;
  acquireSendSlot: () => Promise<void>;
  applyDedupeMarker: (payload: unknown, dedupeKey: string | undefined) => unknown;
  messageHasDedupeMarker: (message: unknown, marker: string) => boolean;
  outboxDedupeMarker: (dedupeKey: string) => string;
  recoveryVerify: boolean;
  recoveryStrict?: boolean;
  historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 25;

interface MessageHistoryChannel {
  messages: {
    fetch(opts: { limit: number }): Promise<unknown>;
  };
}

function hasMessageHistory(channel: unknown): channel is MessageHistoryChannel {
  return !!channel
    && typeof channel === "object"
    && !!(channel as { messages?: unknown }).messages
    && typeof (channel as { messages: { fetch?: unknown } }).messages.fetch === "function";
}

export function createOutboxDelivery(deps: OutboxDeliveryDeps) {
  const {
    canSendEmbeds, isPermanentDiscordError, acquireSendSlot,
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: globalRecoveryVerify, recoveryStrict, historyLimit
  } = deps;
  const limit = historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const strict = recoveryStrict === true;

  async function alreadyPostedInChannel(channel: unknown, dedupeKey: string): Promise<{ found: boolean; failed: boolean }> {
    if (!hasMessageHistory(channel)) return { found: false, failed: false };
    try {
      const recent = await channel.messages.fetch({ limit });
      const list = recent && typeof (recent as { values?: () => Iterable<unknown> }).values === "function"
        ? Array.from((recent as { values: () => Iterable<unknown> }).values())
        : (Array.isArray(recent) ? recent as unknown[] : []);
      const marker = outboxDedupeMarker(dedupeKey);
      return { found: list.some(message => messageHasDedupeMarker(message, marker)), failed: false };
    } catch {
      return { found: false, failed: true };
    }
  }

  async function deliver(client: OutboxDeliveryClient, job: OutboxDeliveryJob): Promise<OutboxDeliveryResult> {
    const verify = job.recoveryVerify ?? globalRecoveryVerify;
    try {
      const botId = client.user?.id;
      if (!botId) return { ok: false, permanent: false };
      const fetched = await client.channels.fetch(job.channelId);
      if (!fetched || !canSendEmbeds(fetched, botId) || !isSendableChannel(fetched)) return { ok: false, permanent: true };
      const channel = fetched;

      const isRecoveryCandidate = verify && !!job.dedupeKey && (job.deliveries ?? 0) > 1;
      if (isRecoveryCandidate) {
        const check = await alreadyPostedInChannel(channel, job.dedupeKey as string);
        if (check.found) return { ok: true, recoveryFetched: true, recoveryDuplicate: true };
        if (check.failed && strict) return { ok: false, permanent: false, recoveryFailed: true };
        const payload = applyDedupeMarker(job.payload, job.dedupeKey);
        await acquireSendSlot();
        await channel.send(payload);
        return { ok: true, recoveryFetched: !check.failed, recoveryFailed: check.failed, recoveryMarkerMissing: !check.failed };
      }

      const payload = verify ? applyDedupeMarker(job.payload, job.dedupeKey) : job.payload;
      await acquireSendSlot();
      await channel.send(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, permanent: isPermanentDiscordError(err) };
    }
  }

  return { deliver, alreadyPostedInChannel };
}
