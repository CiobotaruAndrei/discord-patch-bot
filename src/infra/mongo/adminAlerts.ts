import type { AxiosStatic } from "axios";
import type { LoggerFunction } from "../../types.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import { errorMessage } from "../../shared/errors.js";
import { buildAdminAlertEmbed, toAdminAlertChannelPayload, toAdminAlertWebhookPayload } from "./adminAlertContent.js";
import type { AdminAlertEmbedPayload } from "./adminAlertContent.js";

interface AdminAlertCooldownDoc {
  _id: string;
  lastSentAt: Date;
}

interface MongoDuplicateErrorLike {
  code?: unknown;
  message?: unknown;
}

interface AdminAlertGuildDoc {
  _id: string;
  adminAlertChannelId?: string | null;
}

interface AdminAlertDiscordClient {
  user?: { id?: string } | null;
  channels: {
    fetch(channelId: string): Promise<unknown> | unknown;
  };
}

interface AdminAlertChannel {
  send(payload: unknown): Promise<unknown>;
}

interface AdminAlertsContext {
  env: RuntimeEnv;
  AdminAlertCooldownModel: {
    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<AdminAlertCooldownDoc | null>;
    create(doc: AdminAlertCooldownDoc): Promise<unknown>;
  };
  GuildModel: {
    find(filter: Record<string, unknown>, projection?: Record<string, number>): {
      lean(): Promise<AdminAlertGuildDoc[]>;
    };
    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  };
  axios: AxiosStatic;
  logger: LoggerFunction;
  adminAlert?: typeof adminAlert;
  setAdminAlertDiscordClient?: typeof setAdminAlertDiscordClient;
}

let runtimeContext: Pick<AdminAlertsContext, "env" | "AdminAlertCooldownModel" | "GuildModel" | "axios" | "logger">;
let discordClient: AdminAlertDiscordClient | null = null;

function setAdminAlertDiscordClient(client: AdminAlertDiscordClient | null): void {
  discordClient = client;
}

function isSendableChannel(value: unknown): value is AdminAlertChannel {
  return !!value
    && typeof value === "object"
    && typeof (value as { send?: unknown }).send === "function";
}

function isPermanentDiscordChannelError(err: unknown): boolean {
  return new Set([10003, 10004, 50001, 50013]).has(Number((err as { code?: unknown } | null)?.code));
}

async function sendDiscordAdminAlerts(
  payload: AdminAlertEmbedPayload,
  guildId: string | undefined
): Promise<{ attempted: number; succeeded: number }> {
  const { GuildModel, logger } = runtimeContext;
  const client = discordClient;
  if (!client?.user?.id) return { attempted: 0, succeeded: 0 };
  const filter: Record<string, unknown> = { adminAlertChannelId: { $ne: null } };
  if (guildId) filter._id = guildId;
  const guilds = await GuildModel.find(filter, { _id: 1, adminAlertChannelId: 1 }).lean().catch((err: unknown) => {
    logger("WARN", "ADMIN_ALERT", "Nu am putut citi canalele administrative", errorMessage(err));
    return [];
  });
  let attempted = 0;
  let succeeded = 0;
  for (const guild of guilds) {
    const channelId = guild.adminAlertChannelId;
    if (!channelId) continue;
    attempted++;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!isSendableChannel(channel)) throw Object.assign(new Error("Canal administrativ invalid"), { code: 10003 });
      await channel.send(toAdminAlertChannelPayload(payload));
      succeeded++;
    } catch (err: unknown) {
      logger("WARN", "ADMIN_ALERT", `Nu am putut trimite alerta in canalul administrativ ${channelId}`, errorMessage(err));
      if (isPermanentDiscordChannelError(err)) {
        await GuildModel.updateOne(
          { _id: guild._id, adminAlertChannelId: channelId },
          { $set: { adminAlertChannelId: null } }
        ).catch(() => undefined);
      }
    }
  }
  return { attempted, succeeded };
}

async function resetCooldown(cooldownId: string): Promise<void> {
  const { AdminAlertCooldownModel, logger } = runtimeContext;
  try {
    await AdminAlertCooldownModel.updateOne(
      { _id: cooldownId },
      { $set: { lastSentAt: new Date(0) } }
    );
  } catch (resetErr) {
    logger("WARN", "ADMIN_ALERT", "Nu am putut reseta cooldown-ul dupa esecul livrarii", errorMessage(resetErr));
  }
}

async function adminAlert(kind: string, title: string, body: unknown, guildId?: string): Promise<void> {
  const { env, AdminAlertCooldownModel, axios, logger } = runtimeContext;
  const url = env.ADMIN_WEBHOOK_URL;
  if (!url && !discordClient?.user?.id) return;
  const now = new Date();
  const cooldownThreshold = new Date(now.getTime() - env.ADMIN_ALERT_COOLDOWN_MS);
  const cooldownId = guildId ? `${kind}:${guildId}` : kind;

  let allowed = false;
  try {
    const result = await AdminAlertCooldownModel.findOneAndUpdate(
      { _id: cooldownId, lastSentAt: { $lte: cooldownThreshold } },
      { $set: { lastSentAt: now } },
      { new: false }
    );
    if (result) {
      allowed = true;
    } else {
      try {
        await AdminAlertCooldownModel.create({ _id: cooldownId, lastSentAt: now });
        allowed = true;
      } catch (err) {
        const mongoErr = err as MongoDuplicateErrorLike;
        if (mongoErr.code === 11000) {
          allowed = false;
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    logger("WARN", "ADMIN_ALERT", "Eroare la cooldown DB, sar alerta", errorMessage(err));
    return;
  }

  if (!allowed) return;

  const payload = buildAdminAlertEmbed(kind, title, body, now);
  let attempted = 0;
  let succeeded = 0;
  if (url) {
    attempted++;
    try {
      await axios.post(url, toAdminAlertWebhookPayload(payload), { timeout: 5000 });
      succeeded++;
    } catch (err) {
      logger("WARN", "ADMIN_ALERT", "Nu am putut trimite webhook admin", errorMessage(err));
    }
  }
  const discordResult = await sendDiscordAdminAlerts(payload, guildId);
  attempted += discordResult.attempted;
  succeeded += discordResult.succeeded;
  if (succeeded > 0) {
    logger("INFO", "ADMIN_ALERT", `Alerta trimisa: ${kind} - ${title} (${succeeded}/${attempted} destinatii)`);
    return;
  }
  await resetCooldown(cooldownId);
}

function buildAdminAlertsFrom(context: AdminAlertsContext) {
  runtimeContext = {
    env: context.env,
    AdminAlertCooldownModel: context.AdminAlertCooldownModel,
    GuildModel: context.GuildModel,
    axios: context.axios,
    logger: context.logger
  };

  return { adminAlert, setAdminAlertDiscordClient };
}

function attachAdminAlerts(target: AdminAlertsContext): void {
  Object.assign(target, buildAdminAlertsFrom(target));
}

attachAdminAlerts.buildFrom = buildAdminAlertsFrom;

export default attachAdminAlerts;
