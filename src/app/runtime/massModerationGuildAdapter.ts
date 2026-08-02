"use strict";

import { resolveSanctionActor } from "./sanctionActorAdapter.js";

import type { SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";
import type { MassModerationGuild } from "../../features/command-security/massModerationRuntime.js";

export interface AdaptableModerationGuild {
  id?: unknown;
  ownerId?: unknown;
  roles?: { everyone?: { id?: unknown } };
  members?: { me?: { roles?: { highest?: { position?: unknown } } } | null; fetch?: (options: { user: string; force: boolean }) => Promise<unknown> };
  bans?: { remove?: (userId: string, reason?: string) => Promise<unknown> };
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
      return resolveSanctionActor(guild, actorId);
    },
    async liftBan(targetId, reason) {
      if (!guild.bans?.remove) return false;
      await guild.bans.remove(targetId, reason);
      return true;
    }
  };
}
