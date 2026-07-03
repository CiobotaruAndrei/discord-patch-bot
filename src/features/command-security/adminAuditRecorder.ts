"use strict";

import { recordBotAuditEntry } from "../admin-records/auditLogRepository";
import { canUseGuildModel, commandAuditName, guildIdOf } from "./adminAccessResolver";
import type { AdminCommandGuardContext, AdminGuardInteraction } from "./adminGuardContracts";

export async function recordAdminAudit(
  target: AdminCommandGuardContext | null | undefined,
  interaction: AdminGuardInteraction,
  result: string,
  details = ""
): Promise<void> {
  const guildId = guildIdOf(interaction);
  if (!guildId || !canUseGuildModel(target?.GuildModel)) return;
  await recordBotAuditEntry(target.GuildModel, guildId, {
    userId: interaction.user?.id || "",
    command: commandAuditName(interaction),
    result,
    details
  }).catch(() => undefined);
}
