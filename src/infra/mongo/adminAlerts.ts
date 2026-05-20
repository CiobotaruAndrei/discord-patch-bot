import type { AxiosStatic } from "axios";
import type { Model } from "mongoose";
import type { LoggerFunction, RuntimeEnv } from "../../types";
import { errorMessage } from "../../shared/errors";

interface AdminAlertCooldownDoc {
  _id: string;
  lastSentAt: Date;
}

interface MongoDuplicateErrorLike {
  code?: unknown;
  message?: unknown;
}

interface AdminAlertsContext {
  env: RuntimeEnv;
  AdminAlertCooldownModel: Model<AdminAlertCooldownDoc>;
  axios: AxiosStatic;
  logger: LoggerFunction;
  adminAlert?: typeof adminAlert;
}

let runtimeContext: Pick<AdminAlertsContext, "env" | "AdminAlertCooldownModel" | "axios" | "logger">;

async function adminAlert(kind: string, title: string, body: unknown): Promise<void> {
  const { env, AdminAlertCooldownModel, axios, logger } = runtimeContext;
  const url = env.ADMIN_WEBHOOK_URL;
  if (!url) return;
  const now = new Date();
  const cooldownThreshold = new Date(now.getTime() - env.ADMIN_ALERT_COOLDOWN_MS);

  // Atomic check-and-set: only one instance should win the cooldown race.
  let allowed = false;
  try {
    const result = await AdminAlertCooldownModel.findOneAndUpdate(
      { _id: kind, lastSentAt: { $lte: cooldownThreshold } },
      { $set: { lastSentAt: now } },
      { new: false }
    );
    if (result) {
      allowed = true;
    } else {
      try {
        await AdminAlertCooldownModel.create({ _id: kind, lastSentAt: now });
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

  const payload = {
    embeds: [{
      title: `\u26A0\uFE0F ${title}`,
      description: String(body || "").slice(0, 3500),
      color: 0xe74c3c,
      timestamp: now.toISOString(),
      footer: { text: `kind=${kind}` }
    }]
  };
  try {
    await axios.post(url, payload, { timeout: 5000 });
    logger("INFO", "ADMIN_ALERT", `Alerta trimisa: ${kind} - ${title}`);
  } catch (err) {
    logger("WARN", "ADMIN_ALERT", "Nu am putut trimite webhook admin", errorMessage(err));
  }
}

function attachAdminAlerts(ctx: AdminAlertsContext): void {
  runtimeContext = {
    env: ctx.env,
    AdminAlertCooldownModel: ctx.AdminAlertCooldownModel,
    axios: ctx.axios,
    logger: ctx.logger
  };

  Object.assign(ctx, { adminAlert });
}

export = attachAdminAlerts;
