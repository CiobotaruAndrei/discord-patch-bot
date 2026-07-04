"use strict";

export type AdminAccessGrant = "guild-owner" | "discord-admin" | "configured-role";

export interface AdminAccessPolicyFacts {
  inGuild: boolean;
  ownerOnlyCommand: boolean;
  isGuildOwner: boolean;
  isDiscordAdmin: boolean;
  configuredRoleMatches: boolean;
}

export type AdminAccessDecision =
  | { outcome: "deny-outside-guild" }
  | { outcome: "allow"; grantedBy: AdminAccessGrant }
  | { outcome: "needs-global-code" };

export function decideAdminAccess(facts: AdminAccessPolicyFacts): AdminAccessDecision {
  if (!facts.inGuild) return { outcome: "deny-outside-guild" };
  if (facts.ownerOnlyCommand && facts.isGuildOwner) return { outcome: "allow", grantedBy: "guild-owner" };
  if (facts.isDiscordAdmin) return { outcome: "allow", grantedBy: "discord-admin" };
  if (facts.configuredRoleMatches) return { outcome: "allow", grantedBy: "configured-role" };
  return { outcome: "needs-global-code" };
}

export interface SensitiveAccessFacts {
  sensitiveCommand: boolean;
  allowlist: readonly string[];
  userId: string;
}

export function isSensitiveUserAllowed(allowlist: readonly string[], userId: string): boolean {
  if (!allowlist.length) return true;
  return Boolean(userId) && allowlist.includes(userId);
}

export function decideSensitiveAccess(facts: SensitiveAccessFacts): { blocked: boolean } {
  if (!facts.sensitiveCommand) return { blocked: false };
  return { blocked: !isSensitiveUserAllowed(facts.allowlist, facts.userId) };
}
