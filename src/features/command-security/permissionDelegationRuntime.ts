"use strict";

import { createRoleDelegationRuntime } from "./roleDelegationRuntime.js";
import { createChannelDelegationRuntime } from "./channelDelegationRuntime.js";
import { createSensitiveActionObserver } from "./sensitiveActionObserver.js";

import type { PermissionDelegationRuntimeDeps } from "./permissionDelegationContext.js";

export type { PermissionDelegationRuntimeDeps } from "./permissionDelegationContext.js";

export function createPermissionDelegationRuntime(deps: PermissionDelegationRuntimeDeps) {
  const observer = createSensitiveActionObserver(deps);
  const roleEvents = createRoleDelegationRuntime(deps, observer);
  const channelEvents = createChannelDelegationRuntime(deps, observer);

  return Object.freeze({
    handleRoleUpdate: roleEvents.handleRoleUpdate,
    handleGuildMemberUpdate: roleEvents.handleGuildMemberUpdate,
    handleRoleCreate: roleEvents.handleRoleCreate,
    handleChannelUpdate: channelEvents.handleChannelUpdate,
    handleWebhookUpdate: channelEvents.handleWebhookUpdate
  });
}
