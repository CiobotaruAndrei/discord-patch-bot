"use strict";

import { AuditLogEvent } from "discord.js";

import type { ProtectedResourceType, ResourceChangeAction } from "./protectedResourceTypes.js";

export function auditEventsFor(
  type: ProtectedResourceType,
  actions: readonly ResourceChangeAction[]
): number[] {
  const events = new Set<number>();
  const isRole = type === "role";

  for (const action of actions) {
    if (action === "delete") {
      events.add(isRole ? AuditLogEvent.RoleDelete : AuditLogEvent.ChannelDelete);
      continue;
    }
    if (action === "permissions" && !isRole) {
      events.add(AuditLogEvent.ChannelOverwriteUpdate);
      events.add(AuditLogEvent.ChannelOverwriteCreate);
      events.add(AuditLogEvent.ChannelOverwriteDelete);
      events.add(AuditLogEvent.ChannelUpdate);
      continue;
    }
    events.add(isRole ? AuditLogEvent.RoleUpdate : AuditLogEvent.ChannelUpdate);
  }

  return [...events];
}
