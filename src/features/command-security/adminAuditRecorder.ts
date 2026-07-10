"use strict";

import { recordBotAuditEntry } from "../admin-records/auditLogRepository";
import { commandAuditName, guildIdOf } from "./adminAccessResolver";
import type { AdminCommandGuardContext, AdminGuardAuditModel, AdminGuardInteraction } from "./adminGuardContracts";

function canUseAuditModel(model: AdminGuardAuditModel | null | undefined): model is AdminGuardAuditModel {
  if (!model || typeof model.create !== "function") return false;
  return !(typeof model.db?.readyState === "number" && model.db.readyState !== 1);
}

export async function recordAdminAudit(
  target: AdminCommandGuardContext | null | undefined,
  interaction: AdminGuardInteraction,
  result: string,
  details = ""
): Promise<void> {
  const guildId = guildIdOf(interaction);
  if (!guildId || !canUseAuditModel(target?.GuildAuditLogModel)) return;
  await recordBotAuditEntry(target.GuildAuditLogModel, guildId, {
    userId: interaction.user?.id || "",
    command: commandAuditName(interaction),
    result,
    details
  }).catch(() => undefined);
}
