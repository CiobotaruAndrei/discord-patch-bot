import { errorMessage } from "../../shared/errors.js";
import type { OutboxMessagePayload } from "./outboxTypes.js";
import { notificationKindForContext, DEFAULT_NOTIFICATION_KIND } from "./notificationKinds.js";
import type { NotificationKind } from "./notificationKinds.js";

export const DISCORD_PERMANENT_ERROR_CODES = new Set([10003, 10004, 50001, 50013]);

export type NotificationLogger = (level: string, context: string, message: string, meta?: unknown) => void;
export type DisableChannelFn = (guildId: string, channelId: string, message: string) => Promise<unknown> | unknown;

export interface NotificationDiscordClient {
  user?: { id?: string } | null;
  channels: {
    fetch(channelId: string): Promise<unknown> | unknown;
  };
}

export type OutboxDiscordClient = NotificationDiscordClient & { isReady(): boolean };

export interface OutboundChannelGuild {
  _id: string | number;
  outboxRecoveryVerify?: boolean;
}

export interface ResolveOutboundChannelArgs {
  client: NotificationDiscordClient;
  guild: OutboundChannelGuild;
  channelId: string | null | undefined;
  context: string;
  disableFn: DisableChannelFn;
  bypassOutbox?: boolean;
  manual?: boolean;
}

export interface OutboundHistoryEntry {
  kind: NotificationKind;
  gameKey?: string;
  title?: string;
  link?: string;
  itemId?: string;
}

export interface OutboundSendMeta {
  historyEntries?: OutboundHistoryEntry[];
  availableAt?: Date;
}

export interface OutboundChannel {
  id: string;
  send(payload: OutboxMessagePayload, meta?: OutboundSendMeta): Promise<unknown>;
}

export type ResolveOutboundChannelResult =
  | { abort: true; channel: null }
  | { abort: false; channel: OutboundChannel };

export type EnqueueOutbox = (job: { guildId: string; channelId: string; kind: NotificationKind; payload: OutboxMessagePayload; recoveryVerify?: boolean; manual?: boolean; history?: OutboundHistoryEntry[]; availableAt?: Date }) => Promise<void>;

export type RecordSentHistory = (guildId: string, entries: OutboundHistoryEntry[]) => Promise<void>;

export interface OutboundChannelResolverDeps {
  logger: NotificationLogger;
  canSendEmbeds(channel: unknown, botId: string): boolean;
  acquireSendSlot: () => Promise<void>;
  enqueueOutbox?: EnqueueOutbox;
  recordSentHistory?: RecordSentHistory;
}

function rateLimitedChannel(channel: { id?: unknown; send: (payload: unknown) => Promise<unknown> }, guildId: string, acquireSendSlot: () => Promise<void>, logger: NotificationLogger, recordSentHistory?: RecordSentHistory): OutboundChannel {
  const raw = channel;
  return {
    id: String(raw.id ?? ""),
    send: async (payload: OutboxMessagePayload, meta?: OutboundSendMeta) => {
      await acquireSendSlot();
      const sent = await raw.send(payload);
      if (recordSentHistory && meta?.historyEntries?.length) {
        await recordSentHistory(guildId, meta.historyEntries).catch((err: unknown) => {
          logger("WARN", "HISTORY", `Scrierea notificationHistory a esuat pentru guild ${guildId} (livrare directa); mesajul a fost trimis, dar istoricul intern poate fi incomplet`, errorMessage(err));
        });
      }
      return sent;
    }
  };
}

function outboxChannel(channelId: string, guildId: string, kind: NotificationKind, enqueueOutbox: EnqueueOutbox, recoveryVerify?: boolean, manual?: boolean): OutboundChannel {
  return {
    id: channelId,
    send: async (payload: OutboxMessagePayload, meta?: OutboundSendMeta) =>
      enqueueOutbox({ guildId, channelId, kind, payload, recoveryVerify, manual, history: meta?.historyEntries, availableAt: meta?.availableAt })
  };
}

export function isSendableChannel(channel: unknown): channel is { send: (payload: unknown) => Promise<unknown> } {
  return !!channel && typeof (channel as { send?: unknown }).send === "function";
}

export function isPermanentDiscordError(err: unknown): boolean {
  return DISCORD_PERMANENT_ERROR_CODES.has(Number((err as { code?: unknown } | null)?.code));
}

export const transientErrorMessage = errorMessage;

async function disableSafely(disableFn: DisableChannelFn, guildId: string, channelId: string, message: string): Promise<void> {
  await Promise.resolve(disableFn(guildId, channelId, message)).catch(() => null);
}

export function createOutboundChannelResolver({ logger, canSendEmbeds, acquireSendSlot, enqueueOutbox, recordSentHistory }: OutboundChannelResolverDeps) {
  const acquire = acquireSendSlot;
  return async function resolveOutboundChannel({
    client,
    guild,
    channelId,
    context,
    disableFn,
    bypassOutbox,
    manual
  }: ResolveOutboundChannelArgs): Promise<ResolveOutboundChannelResult> {
    if (!channelId) {
      logger("WARN", context, `Guild ${guild._id} fara canal configurat pentru acest tip de notificari, sar peste ciclu`);
      return { channel: null, abort: true };
    }
    const botId = client.user?.id;
    if (!botId) {
      logger("WARN", context, `Clientul Discord nu e ready (fara user) pentru guild ${guild._id}, sar peste ciclu`);
      return { channel: null, abort: true };
    }
    let channel: unknown | null = null;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (err) {
      if (isPermanentDiscordError(err)) {
        const reason = `Discord cod ${(err as { code?: unknown }).code}: ${transientErrorMessage(err)}`;
        await disableSafely(disableFn, String(guild._id), channelId, reason);
        logger("WARN", context, `Disable pentru guild ${guild._id} - eroare permanenta la fetch canal`, reason);
        return { channel: null, abort: true };
      }
      logger("WARN", context, `Eroare tranzitorie la fetch canal pentru guild ${guild._id}, sar peste ciclu`, transientErrorMessage(err));
      return { channel: null, abort: true };
    }

    if (!channel) {
      const reason = "Canal inexistent (probabil sters).";
      await disableSafely(disableFn, String(guild._id), channelId, reason);
      logger("WARN", context, `Disable pentru guild ${guild._id} - ${reason}`);
      return { channel: null, abort: true };
    }

    if (!canSendEmbeds(channel, botId) || !isSendableChannel(channel)) {
      const message = "Canal invalid sau fara permisiuni View Channel/Send Messages/Embed Links.";
      await disableSafely(disableFn, String(guild._id), channelId, message);
      logger("WARN", context, `${message} Guild ${guild._id}`);
      return { channel: null, abort: true };
    }

    if (enqueueOutbox && !bypassOutbox) {
      const kind = notificationKindForContext(context) ?? DEFAULT_NOTIFICATION_KIND;
      return { channel: outboxChannel(channelId, String(guild._id), kind, enqueueOutbox, guild.outboxRecoveryVerify, manual), abort: false };
    }
    return { channel: rateLimitedChannel(channel, String(guild._id), acquire, logger, recordSentHistory), abort: false };
  };
}
