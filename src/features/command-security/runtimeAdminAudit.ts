"use strict";

import { recordBotAuditEntry } from "../admin-records/auditLogRepository";

type AuditInteraction = { user?: { id?: string } | null };
type GuildModelLike = Parameters<typeof recordBotAuditEntry>[0];

export async function requireGuildAdminAudited<T extends AuditInteraction>(
  requireGuildAdmin: (interaction: T) => Promise<boolean>,
  GuildModel: GuildModelLike,
  interaction: T,
  guildId: string,
  command: string
): Promise<boolean> {
  if (await requireGuildAdmin(interaction)) return true;
  await recordBotAuditEntry(GuildModel, guildId, {
    userId: interaction.user?.id || "",
    command,
    result: "Access denied."
  }).catch(() => undefined);
  return false;
}
