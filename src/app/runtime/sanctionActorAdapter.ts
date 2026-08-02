"use strict";

import { ELEVATED_PERMISSION_FLAGS } from "../../features/command-security/elevatedPermissions.js";

import type { SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";
import type { SanctionActorLike } from "../../features/command-security/elevatedRoleSanction.js";
import type { DelegationSanctionContext } from "../../features/command-security/permissionDelegationContext.js";

export interface SanctionableGuild {
  roles?: { everyone?: { id?: unknown } };
  members?: {
    me?: { roles?: { highest?: { position?: unknown } } } | null;
    fetch?: (options: { user: string; force: boolean }) => Promise<unknown>;
  };
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function elevated(holder: unknown): boolean {
  const permissions = (holder as { permissions?: { has?: (flag: unknown) => boolean } } | null)?.permissions;
  if (!permissions?.has) return false;
  return ELEVATED_PERMISSION_FLAGS.some(flag => permissions.has?.(flag) === true);
}

export async function resolveSanctionActor(guild: SanctionableGuild, actorId: string): Promise<SanctionActorLike | null> {
  const member = await guild.members?.fetch?.({ user: actorId, force: true }).catch(() => null);
  if (!member) return null;

  const holder = member as {
    roles?: { cache?: { values?: () => Iterable<unknown> }; remove?: (ids: readonly string[], reason?: string) => Promise<unknown> };
  };
  const roles: SanctionRole[] = [];
  for (const item of holder.roles?.cache?.values?.() ?? []) {
    const entry = item as { id?: unknown; name?: unknown; position?: unknown; managed?: unknown };
    const id = textOf(entry.id);
    if (!id) continue;
    roles.push({
      id,
      name: textOf(entry.name) ?? id,
      position: numberOf(entry.position) ?? 0,
      managed: entry.managed === true,
      elevated: elevated(entry)
    });
  }

  return { roles, removeRoles: async (ids, reason) => holder.roles?.remove?.(ids, reason) ?? undefined };
}

export function adaptDelegationSanctionContext(guild: SanctionableGuild | null | undefined): DelegationSanctionContext | null {
  if (!guild) return null;
  return {
    botHighestRolePosition: numberOf(guild.members?.me?.roles?.highest?.position),
    everyoneRoleId: textOf(guild.roles?.everyone?.id) ?? "",
    resolveActor: actorId => resolveSanctionActor(guild, actorId)
  };
}
