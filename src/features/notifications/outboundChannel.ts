import { errorMessage } from "../../shared/errors";

export const DISCORD_PERMANENT_ERROR_CODES = new Set([10003, 10004, 50001, 50013]);

export type NotificationLogger = (level: string, context: string, message: string, meta?: unknown) => void;
export type DisableChannelFn = (guildId: string, channelId: string, message: string) => Promise<unknown> | unknown;

export interface OutboundChannelClient {
  user: { id: string };
  channels: {
    fetch(channelId: string): Promise<unknown> | unknown;
  };
}

export interface OutboundChannelGuild {
  _id: string | number;
}

export interface ResolveOutboundChannelArgs {
  client: OutboundChannelClient;
  guild: OutboundChannelGuild;
  channelId: string;
  context: string;
  disableFn: DisableChannelFn;
}

export interface ResolveOutboundChannelResult {
  channel: unknown | null;
  abort: boolean;
}

export interface OutboundChannelResolverDeps {
  logger: NotificationLogger;
  canSendEmbeds(channel: unknown, botId: string): boolean;
}

export function isPermanentDiscordError(err: unknown): boolean {
  return DISCORD_PERMANENT_ERROR_CODES.has(Number((err as { code?: unknown } | null)?.code));
}

export const transientErrorMessage = errorMessage;

async function disableSafely(disableFn: DisableChannelFn, guildId: string, channelId: string, message: string): Promise<void> {
  await Promise.resolve(disableFn(guildId, channelId, message)).catch(() => null);
}

export function createOutboundChannelResolver({ logger, canSendEmbeds }: OutboundChannelResolverDeps) {
  return async function resolveOutboundChannel({
    client,
    guild,
    channelId,
    context,
    disableFn
  }: ResolveOutboundChannelArgs): Promise<ResolveOutboundChannelResult> {
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

    if (!canSendEmbeds(channel, client.user.id)) {
      const message = "Canal invalid sau fara permisiuni Send Messages/Embed Links.";
      await disableSafely(disableFn, String(guild._id), channelId, message);
      logger("WARN", context, `${message} Guild ${guild._id}`);
      return { channel: null, abort: true };
    }

    return { channel, abort: false };
  };
}
