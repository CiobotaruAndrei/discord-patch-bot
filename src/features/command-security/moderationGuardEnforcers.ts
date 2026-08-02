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
  modules: readonly string[];
  factory: (...args: never[]) => unknown;
  sanctionsAuthor: boolean;
}

export const MODERATION_GUARD_ENFORCERS: readonly ModerationGuardEnforcer[] = [
  { type: "bot-add", modules: ["botAddSecurityRuntime"], factory: createBotAddSecurityRuntime, sanctionsAuthor: false },
  { type: "permission-grant", modules: ["roleDelegationRuntime", "channelDelegationRuntime"], factory: createRoleDelegationRuntime, sanctionsAuthor: true },
  { type: "moderation-mass", modules: ["massModerationRuntime"], factory: createMassModerationRuntime, sanctionsAuthor: true },
  { type: "webhook", modules: ["webhookGuardRuntime"], factory: createWebhookGuardRuntime, sanctionsAuthor: true },
  { type: "server-structure", modules: ["serverStructureGuardRuntime"], factory: createServerStructureGuardRuntime, sanctionsAuthor: true },
  { type: "protected-resource-change", modules: ["protectedResourceRuntime"], factory: createProtectedResourceRuntime, sanctionsAuthor: true }
];

export function enforcerFor(type: PermissionRequestType): ModerationGuardEnforcer | undefined {
  return MODERATION_GUARD_ENFORCERS.find(enforcer => enforcer.type === type);
}

export function typesWithoutEnforcer(): PermissionRequestType[] {
  return MODERATION_GUARD_TYPES.filter(type => enforcerFor(type) === undefined);
}
