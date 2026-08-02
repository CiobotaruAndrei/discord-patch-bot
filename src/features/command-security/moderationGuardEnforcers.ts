"use strict";

import { createBotAddSecurityRuntime } from "./botAddSecurityRuntime.js";
import { createRoleDelegationRuntime } from "./roleDelegationRuntime.js";
import { createMassModerationRuntime } from "./massModerationRuntime.js";
import { createWebhookGuardRuntime } from "./webhookGuardRuntime.js";
import { createServerStructureGuardRuntime } from "./serverStructureGuardRuntime.js";
import { createProtectedResourceRuntime } from "./protectedResourceRuntime.js";
import { MODERATION_GUARD_TYPES } from "./moderationGuardDecision.js";

import type { PermissionRequestType } from "./permissionRequestTypes.js";

export interface ModerationGuardEnforcer {
  type: PermissionRequestType;
  module: string;
  factory: (...args: never[]) => unknown;
  sanctionsAuthor: boolean;
}

export const MODERATION_GUARD_ENFORCERS: readonly ModerationGuardEnforcer[] = [
  { type: "bot-add", module: "botAddSecurityRuntime", factory: createBotAddSecurityRuntime, sanctionsAuthor: false },
  { type: "permission-grant", module: "roleDelegationRuntime", factory: createRoleDelegationRuntime, sanctionsAuthor: true },
  { type: "moderation-mass", module: "massModerationRuntime", factory: createMassModerationRuntime, sanctionsAuthor: true },
  { type: "webhook", module: "webhookGuardRuntime", factory: createWebhookGuardRuntime, sanctionsAuthor: true },
  { type: "server-structure", module: "serverStructureGuardRuntime", factory: createServerStructureGuardRuntime, sanctionsAuthor: true },
  { type: "protected-resource-change", module: "protectedResourceRuntime", factory: createProtectedResourceRuntime, sanctionsAuthor: true }
];

export function enforcerFor(type: PermissionRequestType): ModerationGuardEnforcer | undefined {
  return MODERATION_GUARD_ENFORCERS.find(enforcer => enforcer.type === type);
}

export function typesWithoutEnforcer(): PermissionRequestType[] {
  return MODERATION_GUARD_TYPES.filter(type => enforcerFor(type) === undefined);
}
