"use strict";

import { ELEVATED_PERMISSION_FLAGS } from "../../features/command-security/protectedResourceSanction.js";

import type { SanctionRole } from "../../features/command-security/protectedResourceSanction.js";
import type { MassModerationGuild } from "../../features/command-security/massModerationRuntime.js";

export interface AdaptableModerationGuild {
  id?: unknown;
  ownerId?: unknown;
  roles?: { everyone?: { id?: unknown } };
  members?: { me?: { roles?: { highest?: { position?: unknown } } } | null; fetch?: (id: string) => Promise<unknown> };
  bans?: { remove?: (userId: string, reason?: string) => Promise<unknown> };
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasElevated(holder: unknown): boolean {
  const permissions = (holder as { permissions?: { has?: (flag: unknown) => boolean } } | null)?.permissions;
  if (!permissions?.has) return false;
  return ELEVATED_PERMISSION_FLAGS.some(flag => permissions.has?.(flag) === true);
}

export function adaptMassModerationGuild(guild: AdaptableModerationGuild): MassModerationGuild | null {
  const id = textOf(guild.id);
  if (!id) return null;

  return {
    id,
    ownerId: textOf(guild.ownerId),
    botHighestRolePosition: numberOf(guild.members?.me?.roles?.highest?.position),
    everyoneRoleId: textOf(guild.roles?.everyone?.id) ?? "",
    async resolveActor(actorId) {
      const member = await guild.members?.fetch?.(actorId).catch(() => null);
      if (!member) return null;
      const holder = member as {
        roles?: { cache?: { values?: () => Iterable<unknown> }; remove?: (ids: readonly string[], reason?: string) => Promise<unknown> };
      };
      const roles: SanctionRole[] = [];
      for (const item of holder.roles?.cache?.values?.() ?? []) {
        const role = item as { id?: unknown; name?: unknown; position?: unknown; managed?: unknown };
        const roleId = textOf(role.id);
        if (!roleId) continue;
        roles.push({
          id: roleId,
          name: textOf(role.name) ?? roleId,
          position: numberOf(role.position) ?? 0,
          managed: role.managed === true,
          elevated: hasElevated(role)
        });
      }
      return {
        roles,
        removeRoles: async (ids, reason) => { await holder.roles?.remove?.(ids, reason); }
      };
    },
    async liftBan(targetId, reason) {
      if (!guild.bans?.remove) return false;
      await guild.bans.remove(targetId, reason);
      return true;
    }
  };
}
