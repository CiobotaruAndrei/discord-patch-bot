"use strict";

export interface OutboxDeliveryJob {
  channelId: string;
  payload: unknown;
  dedupeKey?: string;
  deliveries?: number;
  recoveryVerify?: boolean;
}

export interface OutboxDeliveryClient {
  user: { id: string };
  channels: { fetch(channelId: string): Promise<unknown> };
}

export type OutboxDeliveryResult =
  | { ok: true; recoveryFetched?: boolean; recoveryDuplicate?: boolean; recoveryFailed?: boolean; recoveryMarkerMissing?: boolean }
  | { ok: false; permanent: boolean };

export interface OutboxDeliveryDeps {
  canSendEmbeds: (channel: unknown, botId: string) => boolean;
  isPermanentDiscordError: (err: unknown) => boolean;
  acquireSendSlot: () => Promise<void>;
  applyDedupeMarker: (payload: unknown, dedupeKey: string | undefined) => unknown;
  messageHasDedupeMarker: (message: unknown, marker: string) => boolean;
  outboxDedupeMarker: (dedupeKey: string) => string;
  recoveryVerify: boolean;
  historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 25;

export function createOutboxDelivery(deps: OutboxDeliveryDeps) {
  const {
    canSendEmbeds, isPermanentDiscordError, acquireSendSlot,
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: globalRecoveryVerify, historyLimit
  } = deps;
  const limit = historyLimit ?? DEFAULT_HISTORY_LIMIT;

  async function alreadyPostedInChannel(channel: unknown, dedupeKey: string): Promise<{ found: boolean; failed: boolean }> {
    const fetcher = (channel as { messages?: { fetch?: (opts: unknown) => Promise<unknown> } } | null)?.messages?.fetch;
    if (typeof fetcher !== "function") return { found: false, failed: false };
    try {
      const recent = await fetcher.call((channel as { messages: unknown }).messages, { limit });
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
      const channel = await client.channels.fetch(job.channelId) as { send?: (payload: unknown) => Promise<unknown> } | null;
      if (!channel || !canSendEmbeds(channel, client.user.id)) return { ok: false, permanent: true };

      const isRecoveryCandidate = verify && !!job.dedupeKey && (job.deliveries ?? 0) > 1;
      if (isRecoveryCandidate) {
        const check = await alreadyPostedInChannel(channel, job.dedupeKey as string);
        if (check.found) return { ok: true, recoveryFetched: true, recoveryDuplicate: true };
        const payload = applyDedupeMarker(job.payload, job.dedupeKey);
        await acquireSendSlot();
        await (channel.send as (payload: unknown) => Promise<unknown>)(payload);
        return { ok: true, recoveryFetched: !check.failed, recoveryFailed: check.failed, recoveryMarkerMissing: !check.failed };
      }

      const payload = verify ? applyDedupeMarker(job.payload, job.dedupeKey) : job.payload;
      await acquireSendSlot();
      await (channel.send as (payload: unknown) => Promise<unknown>)(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, permanent: isPermanentDiscordError(err) };
    }
  }

  return { deliver, alreadyPostedInChannel };
}
